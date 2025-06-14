  require('dotenv').config();
  const express = require('express');
  const twilio = require('twilio');
  const axios = require('axios');
  const fs = require('fs');
  const path = require('path');

  const app = express();
  const port = process.env.PORT || 3000;

  // Check required environment variables
  console.log('Checking environment variables...');
  console.log('Available env vars:', Object.keys(process.env).filter(key => key.includes('TWILIO')));

  // Try API Key first, fallback to Account SID/Token
  let client;
  if (process.env.TWILIO_API_KEY_SID && process.env.TWILIO_API_KEY_SECRET) {
      console.log('Using Twilio API Key authentication');
      client = twilio(
          process.env.TWILIO_API_KEY_SID,
          process.env.TWILIO_API_KEY_SECRET,
          { accountSid: process.env.TWILIO_ACCOUNT_SID }
      );
  } else if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      console.log('Using Twilio Account SID/Token authentication');
      client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  } else {
      console.error('Missing Twilio credentials. Need either:');
      console.error('1. TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET + TWILIO_ACCOUNT_SID');
      console.error('2. TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN');
      process.exit(1);
  }

  if (!process.env.FORWARD_TO_NUMBER || !process.env.WEBHOOK_URL) {
      console.error('Missing required variables: FORWARD_TO_NUMBER or WEBHOOK_URL');
      process.exit(1);
  }

  console.log('✓ Twilio client initialized successfully');

  // Message storage
  const messagesFile = path.join(__dirname, 'messages.json');
  let messages = [];

  // Push token storage
  const pushTokensFile = path.join(__dirname, 'push-tokens.json');
  let pushTokens = [];

  // Load existing messages
  try {
      if (fs.existsSync(messagesFile)) {
          messages = JSON.parse(fs.readFileSync(messagesFile, 'utf8'));
      }
  } catch (error) {
      console.log('No existing messages file, starting fresh');
      messages = [];
  }

  // Load existing push tokens
  try {
      if (fs.existsSync(pushTokensFile)) {
          pushTokens = JSON.parse(fs.readFileSync(pushTokensFile, 'utf8'));
      }
  } catch (error) {
      console.log('No existing push tokens file, starting fresh');
      pushTokens = [];
  }

  // Save messages to file
  function saveMessages() {
      try {
          fs.writeFileSync(messagesFile, JSON.stringify(messages, null, 2));
      } catch (error) {
          console.error('Error saving messages:', error);
      }
  }

  // Save push tokens to file
  function savePushTokens() {
      try {
          fs.writeFileSync(pushTokensFile, JSON.stringify(pushTokens, null, 2));
      } catch (error) {
          console.error('Error saving push tokens:', error);
      }
  }

  // Send push notification to all registered devices
  async function sendPushNotification(title, body, data = {}) {
      if (pushTokens.length === 0) {
          console.log('No push tokens registered, skipping notification');
          return;
      }

      const notifications = pushTokens.map(token => ({
          to: token,
          title: title,
          body: body,
          sound: 'default',
          priority: 'high',
          data: data
      }));

      try {
          const response = await axios.post('https://exp.host/--/api/v2/push/send', notifications, {
              headers: {
                  'Accept': 'application/json',
                  'Content-Type': 'application/json',
              }
          });

          console.log(`Push notification sent to ${pushTokens.length} devices:`, title);

          // Check for invalid tokens and remove them
          if (response.data && response.data.data) {
              response.data.data.forEach((result, index) => {
                  if (result.status === 'error' && result.details && result.details.error === 'DeviceNotRegistered') {
                      console.log('Removing invalid push token:', pushTokens[index]);
                      pushTokens.splice(index, 1);
                      savePushTokens();
                  }
              });
          }
      } catch (error) {
          console.error('Error sending push notification:', error.message);
      }
  }

  // Middleware
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  // CORS for mobile app
  app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      if (req.method === 'OPTIONS') {
          res.sendStatus(200);
      } else {
          next();
      }
  });

  // SMS webhook handler
  app.post('/sms', async (req, res) => {
      try {
          const { From, To, Body, MessageSid, NumMedia } = req.body;

          console.log('SMS received:', { From, To, Body, MessageSid });

          // Store message for mobile app
          const messageData = {
              id: MessageSid,
              type: 'sms',
              from: From,
              to: To,
              body: Body,
              timestamp: new Date().toISOString(),
              read: false,
              replied: false
          };

          messages.unshift(messageData); // Add to beginning of array
          saveMessages();
          console.log(`SMS stored from ${From}: ${Body}`);

          // Send push notification
          const formattedFrom = From.replace(/^\+1/, '').replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
          await sendPushNotification(
              `SMS from ${formattedFrom}`,
              Body,
              { messageId: MessageSid, from: From, type: 'sms' }
          );

          // Send webhook notification
          const webhookData = {
              type: 'sms',
              from: From,
              to: To,
              body: Body,
              messageSid: MessageSid,
              numMedia: NumMedia || 0,
              timestamp: new Date().toISOString(),
              forwardedTo: process.env.FORWARD_TO_NUMBER
          };

          await axios.post(process.env.WEBHOOK_URL, webhookData);
          console.log('SMS webhook sent successfully');

          // Respond with empty TwiML to acknowledge
          res.type('text/xml');
          res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

      } catch (error) {
          console.error('SMS processing error:', error);
          res.status(500).send('Error processing SMS');
      }
  });

  // Voice webhook handler
  app.post('/voice', async (req, res) => {
      try {
          const { From, To, CallSid, CallStatus, Direction } = req.body;

          console.log('Call received:', { From, To, CallSid, CallStatus, Direction });

          // Send call details to webhook
          const webhookData = {
              type: 'call',
              from: From,
              to: To,
              callSid: CallSid,
              callStatus: CallStatus,
              direction: Direction,
              timestamp: new Date().toISOString(),
              forwardedTo: process.env.FORWARD_TO_NUMBER,
              action: 'incoming_call'
          };

          await axios.post(process.env.WEBHOOK_URL, webhookData);
          console.log('Call webhook sent successfully');

          // Create TwiML response to forward the call
          const twiml = `<?xml version="1.0" encoding="UTF-8"?>
  <Response>
      <Say voice="alice">Forwarding your call, please wait.</Say>
      <Dial timeout="30" record="record-from-answer">
          <Number>${process.env.FORWARD_TO_NUMBER}</Number>
      </Dial>
      <Say voice="alice">The call could not be completed. Goodbye.</Say>
  </Response>`;

          res.type('text/xml');
          res.send(twiml);

      } catch (error) {
          console.error('Voice processing error:', error);
          res.status(500).send('Error processing call');
      }
  });

  // Call status webhook handler
  app.post('/call-status', async (req, res) => {
      try {
          const { CallSid, CallStatus, From, To, CallDuration, RecordingUrl } = req.body;

          console.log('Call status update:', { CallSid, CallStatus, From, To, CallDuration });

          // Send call completion details to webhook
          const webhookData = {
              type: 'call_status',
              callSid: CallSid,
              callStatus: CallStatus,
              from: From,
              to: To,
              callDuration: CallDuration || 0,
              recordingUrl: RecordingUrl || null,
              timestamp: new Date().toISOString(),
              action: 'call_completed'
          };

          await axios.post(process.env.WEBHOOK_URL, webhookData);
          console.log('Call status webhook sent successfully');

          res.status(200).send('OK');

      } catch (error) {
          console.error('Call status processing error:', error);
          res.status(500).send('Error processing call status');
      }
  });

  // API endpoints for mobile app

  // Get all messages
  app.get('/api/messages', (req, res) => {
      try {
          res.json({
              success: true,
              messages: messages,
              count: messages.length
          });
      } catch (error) {
          console.error('Error fetching messages:', error);
          res.status(500).json({ success: false, error: 'Failed to fetch messages' });
      }
  });

  // Mark message as read
  app.post('/api/messages/:id/read', (req, res) => {
      try {
          const messageId = req.params.id;
          const message = messages.find(m => m.id === messageId);

          if (message) {
              message.read = true;
              saveMessages();
              res.json({ success: true, message: 'Message marked as read' });
          } else {
              res.status(404).json({ success: false, error: 'Message not found' });
          }
      } catch (error) {
          console.error('Error marking message as read:', error);
          res.status(500).json({ success: false, error: 'Failed to mark message as read' });
      }
  });

  // Mark message as replied
  app.post('/api/messages/:id/replied', (req, res) => {
      try {
          const messageId = req.params.id;
          const message = messages.find(m => m.id === messageId);

          if (message) {
              message.replied = true;
              message.read = true;
              saveMessages();
              res.json({ success: true, message: 'Message marked as replied' });
          } else {
              res.status(404).json({ success: false, error: 'Message not found' });
          }
      } catch (error) {
          console.error('Error marking message as replied:', error);
          res.status(500).json({ success: false, error: 'Failed to mark message as replied' });
      }
  });

  // Get message count
  app.get('/api/messages/count', (req, res) => {
      try {
          const unreadCount = messages.filter(m => !m.read).length;
          res.json({
              success: true,
              total: messages.length,
              unread: unreadCount
          });
      } catch (error) {
          console.error('Error getting message count:', error);
          res.status(500).json({ success: false, error: 'Failed to get message count' });
      }
  });

  // Register push token
  app.post('/api/register-push-token', (req, res) => {
      try {
          const { token } = req.body;

          if (!token) {
              return res.status(400).json({ success: false, error: 'Push token is required' });
          }

          // Add token if not already registered
          if (!pushTokens.includes(token)) {
              pushTokens.push(token);
              savePushTokens();
              console.log('Push token registered:', token.substring(0, 20) + '...');
          }

          res.json({
              success: true,
              message: 'Push token registered successfully',
              registeredTokens: pushTokens.length
          });
      } catch (error) {
          console.error('Error registering push token:', error);
          res.status(500).json({ success: false, error: 'Failed to register push token' });
      }
  });

  // Test push notification endpoint
  app.post('/api/test-push', async (req, res) => {
      try {
          await sendPushNotification(
              'Test Notification',
              'This is a test push notification from your SMS Forwarder',
              { type: 'test' }
          );

          res.json({
              success: true,
              message: `Test notification sent to ${pushTokens.length} devices`
          });
      } catch (error) {
          console.error('Error sending test notification:', error);
          res.status(500).json({ success: false, error: 'Failed to send test notification' });
      }
  });

  // Health check endpoint
  app.get('/', (req, res) => {
      res.json({
          status: 'running',
          endpoints: {
              sms: '/sms',
              voice: '/voice',
              callStatus: '/call-status',
              api: '/api/messages',
              pushToken: '/api/register-push-token',
              testPush: '/api/test-push'
          },
          registeredDevices: pushTokens.length,
          messageCount: messages.length
      });
  });

  app.listen(port, () => {
      console.log(`Twilio forwarder server running on port ${port}`);
      console.log(`SMS webhook: http://localhost:${port}/sms`);
      console.log(`Voice webhook: http://localhost:${port}/voice`);
      console.log(`Call status webhook: http://localhost:${port}/call-status`);
  });

