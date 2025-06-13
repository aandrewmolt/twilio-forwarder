require('dotenv').config();
const twilio = require('twilio');

async function createApiKey() {
    try {
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        
        const apiKey = await client.newKeys.create({
            friendlyName: 'Twilio Forwarder API Key'
        });

        console.log('\n🔑 Twilio API Key Created Successfully!');
        console.log('═'.repeat(50));
        console.log(`API Key SID: ${apiKey.sid}`);
        console.log(`API Key Secret: ${apiKey.secret}`);
        console.log('═'.repeat(50));
        console.log('\n📝 Add these to your .env file:');
        console.log(`TWILIO_API_KEY_SID=${apiKey.sid}`);
        console.log(`TWILIO_API_KEY_SECRET=${apiKey.secret}`);
        console.log('\n⚠️  Save the secret now - it won\'t be shown again!');
        
    } catch (error) {
        console.error('Error creating API key:', error);
    }
}

createApiKey();