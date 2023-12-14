const express = require('express');
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const fs = require('fs');

const app = express();
const port = 3001;

// Create the 'uploads' directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Set up multer for handling file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  },
});

const upload = multer({ storage: storage });

// Serve the frontend
app.use(express.static(path.join(__dirname, 'frontend', 'build')));

// Handle file uploads
app.post('/upload', upload.array('images'), async (req, res) => {
  try {
    // Assuming you want to process each uploaded image individually
    for (const file of req.files) {
      const inputPath = path.join(__dirname, 'uploads', file.filename);
      const outputPath = path.join(__dirname, 'uploads/processed', file.filename);

      await cropImage(inputPath, outputPath, 1200, 1200);
    }

    console.log('Files uploaded and processed successfully');
    res.status(200).send('Files uploaded and processed successfully');
  } catch (error) {
    console.error('Error uploading and processing images:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

async function getAllPixels(filePath) {
  try {
    const image = sharp(filePath);

    // Explicitly specify the number of channels (RGB images have 3 channels)
    const pixelData = await image.raw().toBuffer({ resolveWithObject: true, channels: 3 });
    const { data, info } = pixelData;

    const width = info.width;
    const height = info.height;

    const pixels = [];
    for (let y = 0; y < height; y++) {
      pixels.push([]);
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 3;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        pixels[y].push([ r, g, b ]);
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

async function cropImage(inputPath, outputPath, targetHeight, targetWidth) {
  const pixelData = await getAllPixels(inputPath);
  const whiteRows = new Set();
  const whiteCols = new Set();

  const treshold = getAverage(pixelData.pixels.flat().flat()) * 1.03;

  console.log(pixelData.width, pixelData.height)
  for(let x = 0; x < pixelData.width; x++)
    if(isWhiteRow(x, pixelData.height, pixelData.pixels, treshold+4)) whiteCols.add(x);
  for(let y = 0; y < pixelData.height; y++)
    if(isWhiteColumn(y, pixelData.width, pixelData.pixels, treshold+4)) whiteRows.add(y);

  console.log(whiteCols, whiteRows)
  const [colStart, colEnd] = getBorders(whiteCols, whiteCols.size)
  const [rowStart, rowEnd] = getBorders(whiteRows, whiteRows.size)

  const resizedImage = await sharp(inputPath)
    .extract({ left: colStart, top: rowStart, width: colEnd - colStart, height: rowEnd - rowStart })
    .resize(targetWidth, targetHeight, { fit: 'contain', position: 'centre', background: 'white' })
    .toBuffer();

  await sharp({
    create: {
      width: 1620,
      height: 1620,
      channels: 3,
      background: 'white',
    },
  })
    .composite([
      {
        input: resizedImage,
        left: Math.floor((1620 - targetWidth) / 2),
        top: Math.floor((1620 - targetHeight) / 2),
      },
    ])
    .toFile(outputPath);
}