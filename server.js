const express = require('express');
const cors = require('cors');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { spawn } = require('child_process');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(cors());

// פונקציית עזר לבניית כתובת המקור
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
        const msg = err.message || '';
        if (
          !msg.includes('Output stream closed') &&
          !msg.includes('pipe') &&
          !msg.includes('SIGKILL') &&
          !msg.includes('killed')
        ) {
          console.error('FFmpeg Streaming Error:', msg);
        }
      });

    // ניקוי משאבים כשמשתמש עוצר/מעביר שיר בדפדפן
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

  const sourceUrl = getSourceUrl(id, token);

  try {
    // Axios מוריד את הזרם ויודע להתמודד עם ה-Redirects של גוגל
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
    let resolved = false;

    // השתקת שגיאות EPIPE בלוגים בזמן סגירה יזוקה של הצינור
    ffmpegProc.stdin.on('error', () => {});
    if (response.data) {
      response.data.on('error', () => {});
    }

    response.data.pipe(ffmpegProc.stdin);

    ffmpegProc.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();

      // זיהוי אורך השיר מתוך כותרת ה-WMA
      const match = stderrData.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+|\d+)/);
      if (match && !resolved) {
        resolved = true;
        const hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const seconds = parseFloat(match[3]);
        const totalSeconds = Math.round(hours * 3600 + minutes * 60 + seconds);

        // ניתוק מיידי ונקי של הזרם והתהליך
        response.data.destroy();
        ffmpegProc.kill('SIGKILL');

        return res.json({ duration: totalSeconds });
      }
    });

    ffmpegProc.on('close', () => {
      if (!resolved && !res.headersSent) {
        console.error("Could not parse duration from stream. Stderr:\n", stderrData.slice(-300));
        res.json({ duration: 0 });
      }
    });

  } catch (error) {
    console.error("Error fetching wma-duration stream:", error.message);
    if (!res.headersSent) res.json({ duration: 0 });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
