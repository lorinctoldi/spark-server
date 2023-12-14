const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const cors = require('cors')

require('dotenv').config();



const app = express();
const port = process.env.PORT || 3000;


app.use(cors());

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const storage = multer.memoryStorage(); // Use memory storage to get the buffer in memory
const upload = multer({ storage: storage });

app.use(express.static(path.join(__dirname, 'frontend', 'build')));

app.post('/upload', upload.array('images'), async (req, res) => {
  try {
    const processedImages = [];

    for (const file of req.files) {
      const processedImageBuffer = await cropImage(file.buffer, file.originalname, Array.isArray(req.body.company) ? req.body.company[0] : req.body.company, req.body.crop);
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

async function cropImage(buffer, filename, company, crop) {
  try {
    console.log(company)
    const [targetHeight, targetWidth] = (company === "spark") ? [1492, 1080] : [1220, 1220];
    const [canvasHeight, canvasWidth] = (company === "spark") ? [1620, 1080] : [1620, 1620];

    const jpgBuffer = await sharp(buffer)
      .flatten({ background: { r: 255, g: 255, b: 255, alpha: 1 } }) // Set transparent parts to white
      .jpeg({ quality: 100, force: true }) // Convert to JPG format
      .toBuffer();
      
      if(crop === 'no-crop') {
        return await sharp(jpgBuffer).toFormat("webp")
        .toBuffer();
      }
      const pixelData = await getAllPixels(jpgBuffer);
      const whiteRows = new Set();
      const whiteCols = new Set();
      
      const treshold = Math.min(getAverage(pixelData.pixels.flat().flat()) * 1.03, 250);
      console.log(treshold);
      for (let x = 0; x < pixelData.width; x++)
      if (isWhiteRow(x, pixelData.height, pixelData.pixels, treshold)) whiteCols.add(x);
      for (let y = 0; y < pixelData.height; y++)
      if (isWhiteColumn(y, pixelData.width, pixelData.pixels, treshold)) whiteRows.add(y);
      let [colStart, colEnd] = getBorders(whiteCols, whiteCols.size);
      let [rowStart, rowEnd] = getBorders(whiteRows, whiteRows.size);
      if(colStart === undefined) colStart = 0;
      if(rowStart === undefined) rowStart = 0;
      if(colEnd === undefined) colEnd = pixelData.width;
      if(rowEnd === undefined) rowEnd = pixelData.height;
    console.log('Crop Coordinates:', colStart, colEnd, rowStart, rowEnd);

    // Ensure that the crop coordinates are valid before using sharp
    if (colStart !== undefined && colEnd !== undefined && rowStart !== undefined && rowEnd !== undefined) {
      // Use sharp directly with the buffer and obtain the processed image as a buffer
      const croppedImage = await sharp(jpgBuffer)
        .extract({ left: colStart, top: rowStart, width: colEnd - colStart, height: rowEnd - rowStart })
        .resize(targetWidth, targetHeight, { fit: 'contain', position: 'centre', background: 'white' })
        .toBuffer();

        const resizedImage = await sharp({
          create: {
            width: canvasWidth,
            height: canvasHeight,
            channels: 3,
            background: 'white',
          },
        })
        .composite([
          {
            input: croppedImage,
            left: (company !== "spark") ?
              Math.floor((canvasWidth - targetWidth) / 2) :
              0,
            top: (company !== "spark") ? 
              Math.floor((canvasHeight - targetHeight) / 2) :
              97,
          },
        ])
        .toFormat("webp")
        .toBuffer();

      console.log('Image processed successfully');

      return resizedImage;
    } else {
      console.error('Error: Invalid crop coordinates');
    }
  } catch (error) {
    console.error('Error processing image:', error);
  }
}

