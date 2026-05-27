// MeetLingo — Model checker (no dotenv needed)
const https = require('https');
const fs    = require('fs');

// Read API key directly from .env file
let key = '';
try {
    const env = fs.readFileSync('.env', 'utf8');
    const match = env.match(/OPENAI_API_KEY=(.+)/);
    if (match) key = match[1].trim();
} catch(e) {
    console.error('❌ .env nicht gefunden. Bitte im MEETLINGO Ordner ausführen.');
    process.exit(1);
}

if (!key) { console.error('❌ API Key leer'); process.exit(1); }
console.log('✅ Key:', key.slice(0,14) + '...');
console.log('🔍 Verbinde mit OpenAI...');

https.get('https://api.openai.com/v1/models', {
    headers: { 'Authorization': 'Bearer ' + key }
}, (res) => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => {
        if (res.statusCode !== 200) {
            console.error('❌ HTTP ' + res.statusCode + ':', body.slice(0, 300));
            return;
        }
        const models  = JSON.parse(body).data.map(m => m.id).sort();
        const rt      = models.filter(m => m.includes('realtime'));

        console.log('\n=== REALTIME MODELLE (' + rt.length + ') ===');
        if (rt.length === 0) {
            console.log('⚠️  KEINE — dieser Key hat keinen Realtime-Zugriff!');
        } else {
            rt.forEach(m => console.log(' ✅', m));
        }

        console.log('\n=== ALLE MODELLE (' + models.length + ') ===');
        models.forEach(m => console.log(' •', m));
    });
}).on('error', e => console.error('❌ Netzwerkfehler:', e.message));
