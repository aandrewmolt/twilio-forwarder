# Twilio SMS & Call Forwarder

Automatically forwards SMS messages and calls from your Twilio number while sending formatted data to a webhook.

## Setup

1. Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   cp .env.example .env
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   npm start
   ```

## Configuration

Update your `.env` file with:
- `TWILIO_ACCOUNT_SID`: Your Twilio Account SID
- `TWILIO_AUTH_TOKEN`: Your Twilio Auth Token  
- `FORWARD_TO_NUMBER`: Phone number to forward calls/SMS to
- `WEBHOOK_URL`: Your webhook endpoint (already set to Boost.space)

## Twilio Webhook Configuration

Configure these webhooks in your Twilio console for number `+1 432 224 8252`:

- **SMS webhook**: `https://yourdomain.com/sms`
- **Voice webhook**: `https://yourdomain.com/voice`
- **Call status webhook**: `https://yourdomain.com/call-status`

## Webhook Data Format

### SMS Data
```json
{
  "type": "sms",
  "from": "+1234567890",
  "to": "+14322248252", 
  "body": "Message content",
  "messageSid": "SM...",
  "numMedia": 0,
  "timestamp": "2024-01-01T12:00:00.000Z",
  "forwardedTo": "+1987654321"
}
```

### Call Data
```json
{
  "type": "call",
  "from": "+1234567890",
  "to": "+14322248252",
  "callSid": "CA...",
  "callStatus": "ringing",
  "direction": "inbound",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "forwardedTo": "+1987654321",
  "action": "incoming_call"
}
```