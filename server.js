const express = require('express');
const cors = require('cors');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { spawn } = require('child_process');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(cors());

// פונקציית עזר להחלטה על מקור הקובץ
function getSourceUrl(id, token) {
  if (token && token !== 'undefined' && token.trim() !== '') {
    const workerBaseUrl = 'https://misty-block-12ce.a0527694506.workers.dev';
    return `${workerBaseUrl}?id=${id}&token=${encodeURIComponent(token)}`;
  }
  return `https://lh3.googleusercontent.com/d/${id}`;
}

// 1. נתיב להזרמה והמרת WMA בלייב
app.get('/stream-wma', async (req, res) => {
  const { id, token } = req.query;

  if (!id) {
    return res.status(400).send("Missing track ID");
  }

  const sourceUrl = getSourceUrl(id, token);

  try {
    const response = await axios({
      method: 'get',
      url: sourceUrl,
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
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
app.get('/wma-duration', async (req, res) => {
  const { id, token } = req.query;

  if (!id) {
    return res.status(400).json({ error: "Missing track ID" });
  }

  const sourceUrl = getSourceUrl(id, token);

  try {
    const response = await axios({
      method: 'get',
      url: sourceUrl,
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });

    const ffmpegProc = spawn(ffmpegPath, ['-i', 'pipe:0']);
    let stderrData = '';

    response.data.pipe(ffmpegProc.stdin);

    ffmpegProc.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();

      // חילוץ האורך ברגע שהכותרת (Header) של ה-WMA נקראת
      const match = stderrData.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+|\d+)/);
      if (match && !res.headersSent) {
        const hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const seconds = parseFloat(match[3]);
        const totalSeconds = Math.round(hours * 3600 + minutes * 60 + seconds);

        // עצירת ההורדה והתהליך מיד לאחר מציאת האורך (לחסכון בזמן ומשאבים)
        response.data.destroy();
        ffmpegProc.kill();
        return res.json({ duration: totalSeconds });
      }
    });

    ffmpegProc.on('close', () => {
      if (!res.headersSent) {
        console.error("FFmpeg finished without duration match. Output logs:\n", stderrData);
        res.json({ duration: 0 });
      }
    });

    ffmpegProc.on('error', (err) => {
      console.error("FFmpeg process error:", err);
      if (!res.headersSent) res.json({ duration: 0 });
    });

  } catch (error) {
    console.error("Error in /wma-duration fetch:", error.message);
    res.json({ duration: 0 });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
