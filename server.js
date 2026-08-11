const express = require('express');
const cors = require('cors');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { execFile } = require('child_process');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(cors());

// פונקציה לשליפת ה-URL הישיר והסופי לאחר הפניות (Redirects) של גוגל
async function getDirectUrl(id, token) {
  if (token && token !== 'undefined' && token.trim() !== '') {
    const workerBaseUrl = 'https://misty-block-12ce.a0527694506.workers.dev';
    return `${workerBaseUrl}?id=${id}&token=${encodeURIComponent(token)}`;
  }

  const initialUrl = `https://lh3.googleusercontent.com/d/${id}`;
  try {
    const res = await axios.get(initialUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      maxRedirects: 5,
      responseType: 'stream'
    });
    const finalUrl = res.request.res.responseUrl || initialUrl;
    res.data.destroy(); // סגירת הזרם מיד לאחר קבלת ה-URL
    return finalUrl;
  } catch (e) {
    return initialUrl;
  }
}

// 1. נתיב להזרמה והמרת WMA בלייב ל-MP3
app.get('/stream-wma', async (req, res) => {
  const { id, token } = req.query;

  if (!id) {
    return res.status(400).send("Missing track ID");
  }

  try {
    const sourceUrl = await getDirectUrl(id, token);

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
        const msg = err.message || '';
        // התעלמות משגיאות סגירה רגילות והריגת תהליך יזוקה
        if (
          !msg.includes('Output stream closed') &&
          !msg.includes('pipe') &&
          !msg.includes('SIGKILL') &&
          !msg.includes('killed')
        ) {
          console.error('FFmpeg Streaming Error:', msg);
        }
      });

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
app.get('/wma-duration', async (req, res) => {
  const { id, token } = req.query;

  if (!id) {
    return res.status(400).json({ error: "Missing track ID" });
  }

  try {
    const sourceUrl = await getDirectUrl(id, token);

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

      console.error("Could not parse duration. FFmpeg output tail:\n", stderr.slice(-400));
      res.json({ duration: 0 });
    });
  } catch (err) {
    console.error("Error resolving direct URL for duration:", err.message);
    res.json({ duration: 0 });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
