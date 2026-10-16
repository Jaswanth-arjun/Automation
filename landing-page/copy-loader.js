const fs = require('fs');
fs.mkdirSync('public', { recursive: true });
fs.copyFileSync('D:/Temp/opencode/hamster-loader.mp4', 'public/hamster-loader.mp4');
console.log('copied', fs.statSync('public/hamster-loader.mp4').size);
