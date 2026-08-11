const express = require('express');
const cors = require('cors');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { execFile } = require('child_process');

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

// 1. נתיב להזרמה והמרת WMA בלייב ל-MP3
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

    const command = ffmpeg(response.data)
      .audioCodec('libmp3lame')
      .audioBitrate(128)
      .format('mp3')
      .on('error', (err) => {
        // התעלמות משגיאות ניתוק רגילות של הדפדפן בזמן עצירת שיר
        if (!err.message.includes('Output stream closed') && !err.message.includes('pipe')) {
          console.error('FFmpeg Streaming Error:', err.message);
        }
      });

    // סגירה נקייה של ffmpeg במידה והמשתמש עצר/עבר שיר בדפדפן
    req.on('close', () => {
      command.kill('SIGKILL');
      if (response.data) response.data.destroy();
    });

    command.pipe(res, { end: true });

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

  const sourceUrl = getSourceUrl(id, token);

  // הרצת ffmpeg ישירות עם User-Agent עוקף חסימות (ללא Pipes שיוצרים EPIPE)
  const args = [
    '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    '-i', sourceUrl
  ];

  execFile(ffmpegPath, args, (error, stdout, stderr) => {
    const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+|\d+)/);
    if (match) {
      const hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const seconds = parseFloat(match[3]);
      const totalSeconds = Math.round(hours * 3600 + minutes * 60 + seconds);
      return res.json({ duration: totalSeconds });
    }

    console.error("Could not parse duration. FFmpeg output tail:\n", stderr.slice(-300));
    res.json({ duration: 0 });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
