const express = require('express');
const cors = require('cors');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { execFile } = require('child_process');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(cors());

// 1. נתיב להזרמה והמרת WMA בלייב
app.get('/stream-wma', async (req, res) => {
  const { id, token } = req.query;

  if (!id) {
    return res.status(400).send("Missing track ID");
  }

  const workerBaseUrl = 'https://misty-block-12ce.a0527694506.workers.dev';
  const sourceUrl = `${workerBaseUrl}?id=${id}&token=${encodeURIComponent(token || '')}`;

  try {
    const response = await axios({
      method: 'get',
      url: sourceUrl,
      responseType: 'stream'
    });

    res.setHeader('Content-Type', 'audio/mpeg');

    ffmpeg(response.data)
      .audioCodec('libmp3lame')
      .audioBitrate(128)
      .format('mp3')
      .on('error', (err) => {
        if (!err.message.includes('Output stream closed')) {
          console.error('FFmpeg Error:', err.message);
        }
      })
      .pipe(res, { end: true });

  } catch (error) {
    console.error('Error fetching stream:', error.message);
    if (!res.headersSent) {
      res.status(500).send('Error processing audio stream');
    }
  }
});

// 2. נתיב לשליפת אורך השיר בשניות עבור הנגן
app.get('/wma-duration', (req, res) => {
  const { id, token } = req.query;

  if (!id) {
    return res.status(400).json({ error: "Missing track ID" });
  }

  const workerBaseUrl = 'https://misty-block-12ce.a0527694506.workers.dev';
  const sourceUrl = `${workerBaseUrl}?id=${id}&token=${encodeURIComponent(token || '')}`;

  // הרצת ffmpeg לקריאת אורך השיר
  execFile(ffmpegPath, ['-i', sourceUrl], (error, stdout, stderr) => {
    const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+|\d+)/);
    if (match) {
      const hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const seconds = parseFloat(match[3]);
      const totalSeconds = Math.round(hours * 3600 + minutes * 60 + seconds);
      return res.json({ duration: totalSeconds });
    }
    res.json({ duration: 0 });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
