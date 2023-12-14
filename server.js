const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const cors = require('cors')


const app = express();
const port = 3001;

app.use(cors());

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const storage = multer.memoryStorage(); // Use memory storage to get the file buffer in memory
const upload = multer({ storage: storage });

app.use(express.static(path.join(__dirname, 'frontend', 'build')));

app.post('/upload', upload.array('images'), async (req, res) => {
  try {
    const processedImages = [];

    for (const file of req.files) {
      const processedImageBuffer = await cropImage(file.buffer, file.originalname, 1200, 1200);
      const base64Image = processedImageBuffer.toString('base64');
      processedImages.push({ name: file.originalname, data: base64Image });
    }

    console.log('Files uploaded and processed successfully');
    res.status(200).json({ success: true, processedImages });
  } catch (error) {
    console.error('Error uploading and processing images:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

async function getAllPixels(buffer) {
  try {
    const image = sharp(buffer);

    // Ensure we set the number of channels appropriately based on the input image
    const { channels } = await image.metadata();

    const pixelData = await image.raw().toBuffer({ resolveWithObject: true, channels });
    const { data, info } = pixelData;

    const width = info.width;
    const height = info.height;

    const pixels = [];
    for (let y = 0; y < height; y++) {
      pixels.push([]);
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * channels;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];

        pixels[y].push([r, g, b]);
      }
    }

    return { height, width, pixels };
  } catch (error) {
    console.error('Error getting pixels:', error);
    return [];
  }
}

const getAverage = array => array.reduce((a, b) => a + b) / array.length;

function isWhiteRow(x, height, pixels, whiteThreshold) {
  const averages = [];
  for(let y = 0; y < height; y++) {
    const [r,g,b] = pixels[y][x];
    const average = Math.round((r+g+b)/3)
    if (average < whiteThreshold) return false;
    averages.push(average)
  }
  if(getAverage(averages) > whiteThreshold) return true;
  return false;
}

function isWhiteColumn(y, width, pixels, whiteThreshold) {
  const averages = [];
  for(let x = 0; x < width; x++) {
    const [r,g,b] = pixels[y][x];
    const average = Math.round((r+g+b)/3)
    if (average < whiteThreshold) return false;
    averages.push(average)
  }
  if(getAverage(averages) > whiteThreshold) return true;
  return false;
}

function getBorders(set, size) {
  let start, end;
  const arr = Array.from(set);
  for(let i = 1; i < size; i++) { 
    if(arr[i-1] + 1 !== arr[i]) {
      start = arr[i-1];
      break;
    }
  }
  for(let i = size-2; i >= 0; i--) { 
    if(arr[i] + 1 !== arr[i+1]) {
      end = arr[i+1];
      break;
    }
  }
  return [start, end];
}

async function cropImage(buffer, filename, targetHeight, targetWidth) {
  try {
    console.log('__dirname:', __dirname);
    console.log('filename:', filename);

    const pixelData = await getAllPixels(buffer);
    const whiteRows = new Set();
    const whiteCols = new Set();

    const treshold = getAverage(pixelData.pixels.flat().flat()) * 1.03;

    for (let x = 0; x < pixelData.width; x++)
      if (isWhiteRow(x, pixelData.height, pixelData.pixels, treshold + 4)) whiteCols.add(x);
    for (let y = 0; y < pixelData.height; y++)
      if (isWhiteColumn(y, pixelData.width, pixelData.pixels, treshold + 4)) whiteRows.add(y);

    const [colStart, colEnd] = getBorders(whiteCols, whiteCols.size);
    const [rowStart, rowEnd] = getBorders(whiteRows, whiteRows.size);

    console.log('Crop Coordinates:', colStart, colEnd, rowStart, rowEnd);

    // Ensure that the crop coordinates are valid before using sharp
    if (colStart !== undefined && colEnd !== undefined && rowStart !== undefined && rowEnd !== undefined) {
      // Use sharp directly with the buffer and obtain the processed image as a buffer
      const croppedImage = await sharp(buffer)
        .extract({ left: colStart, top: rowStart, width: colEnd - colStart, height: rowEnd - rowStart })
        .resize(targetWidth, targetHeight, { fit: 'contain', position: 'centre', background: 'white' })
        .toBuffer();

        const fileExtension = 'webp';

        // Create the output path with the original filename and WebP extension
        const outputPath = path.join(__dirname, 'uploads', `${path.parse(filename).name}.${fileExtension}`);

        const resizedImage = await sharp({
          create: {
            width: 1620,
            height: 1620,
            channels: 3,
            background: 'white',
          },
        })
        .composite([
          {
            input: croppedImage,
            left: Math.floor((1620 - targetWidth) / 2),
            top: Math.floor((1620 - targetHeight) / 2),
          },
        ])
        .toFormat("webp")
        .toBuffer();

        console.log(filename)

        // Now you can save the processedImageBuffer or do further processing as needed
        fs.writeFileSync(outputPath, resizedImage);


      console.log('Image processed successfully');

      return resizedImage;
    } else {
      console.error('Error: Invalid crop coordinates');
    }
  } catch (error) {
    console.error('Error processing image:', error);
  }
}

