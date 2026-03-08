const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { Constants } = require('librechat-data-provider');
const { logger } = require('@librechat/data-schemas');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { getMessages, deleteMessages } = require('~/models/Message');
const { getConvo, saveConvo } = require('~/models/Conversation');
const { compactMessages } = require('~/server/services/compaction');
const { exportConversation } = require('~/server/services/compaction/export');
const { Message } = require('~/db/models');

const EXPORT_DIR = process.env.COMPACTION_EXPORT_DIR || '/app/exports';

const router = express.Router();
router.use(requireJwtAuth);

/**
 * POST /:conversationId/compact
 *
 * Compacts a conversation by summarizing old messages, exporting the full
 * history to a Markdown file, then replacing all messages with a compact set
 * (summary user message, assistant acknowledgement, latest user message).
 *
 * @param {string} req.params.conversationId - The conversation to compact.
 * @returns {object} 200 - Success response with export path and stats.
 */
router.post('/:conversationId/compact', async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user?.id ?? req.user?._id;

  try {
    // 1. Verify the conversation exists and belongs to the requesting user
    const convo = await getConvo(userId, conversationId);
    if (!convo) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // 2. Load all messages from MongoDB
    const messages = await getMessages({ conversationId });
    if (!messages || messages.length === 0) {
      return res.status(400).json({ error: 'No messages to compact' });
    }

    // 3. Convert to simple {role, content} format for the compaction engine
    const simpleMessages = [];

    // Check if first message looks like a system message — if not, prepend a placeholder
    const firstMsg = messages[0];
    const firstIsSystem =
      firstMsg.isCreatedByUser === false &&
      firstMsg.sender !== 'User' &&
      firstMsg.text &&
      messages.length > 1 &&
      messages[1].isCreatedByUser === true;

    if (!firstIsSystem) {
      simpleMessages.push({ role: 'system', content: 'You are a helpful assistant.' });
    }

    for (const msg of messages) {
      let role;
      if (firstIsSystem && msg === firstMsg) {
        role = 'system';
      } else if (msg.isCreatedByUser) {
        role = 'user';
      } else {
        role = 'assistant';
      }

      const content = typeof msg.text === 'string' ? msg.text : '';
      if (content) {
        simpleMessages.push({ role, content });
      }
    }

    // 4. Run compaction
    const result = compactMessages(simpleMessages);
    if (!result) {
      return res.status(400).json({ error: 'Not enough messages to compact' });
    }

    // 5. Export full history to .md file
    const exportMessages = messages.map((msg) => ({
      role: msg.isCreatedByUser ? 'user' : 'assistant',
      content: typeof msg.text === 'string' ? msg.text : '',
      createdAt: msg.createdAt,
      sender: msg.sender,
      name: msg.name,
    }));

    const exportedPath = exportConversation({
      conversationId,
      title: convo.title || 'Untitled',
      messages: exportMessages,
      exportDir: EXPORT_DIR,
    });

    const removedCount = messages.length;

    // 6. Delete all old messages
    await deleteMessages({ conversationId });

    // 7. Insert 3 new messages: summary user, assistant ack, latest user msg
    // Preserve the original conversation's endpoint and model from the last assistant message
    const lastAssistantMsg = [...messages].reverse().find((m) => !m.isCreatedByUser);
    const endpoint = lastAssistantMsg?.endpoint || convo.endpoint || '';
    const model = lastAssistantMsg?.model || convo.model || '';

    const summaryMsgId = uuidv4();
    const ackMsgId = uuidv4();
    const latestMsgId = uuidv4();
    const now = new Date();

    const newMessages = [
      {
        messageId: summaryMsgId,
        conversationId,
        parentMessageId: Constants.NO_PARENT,
        user: userId,
        text: result.summaryContent,
        sender: 'User',
        isCreatedByUser: true,
        endpoint,
        model,
        createdAt: new Date(now.getTime()),
        updatedAt: new Date(now.getTime()),
      },
      {
        messageId: ackMsgId,
        conversationId,
        parentMessageId: summaryMsgId,
        user: userId,
        text: 'Continuing seamlessly.',
        sender: 'Agent',
        isCreatedByUser: false,
        endpoint,
        model,
        createdAt: new Date(now.getTime() + 1),
        updatedAt: new Date(now.getTime() + 1),
      },
      {
        messageId: latestMsgId,
        conversationId,
        parentMessageId: ackMsgId,
        user: userId,
        text: result.lastUserMessage,
        sender: 'User',
        isCreatedByUser: true,
        endpoint,
        model,
        createdAt: new Date(now.getTime() + 2),
        updatedAt: new Date(now.getTime() + 2),
      },
    ];

    await Message.insertMany(newMessages);

    // Update conversation to reflect new message structure
    await saveConvo(
      req,
      { conversationId },
      { context: `POST /api/conversations/${conversationId}/compact` },
    );

    // 8. Return success response
    res.status(200).json({
      success: true,
      exported: exportedPath,
      messages_removed: removedCount,
      summary_sentences: result.selectedCount,
      new_message_count: 3,
    });
  } catch (error) {
    logger.error('[compact] Error compacting conversation', error);
    res.status(500).json({ error: 'Error compacting conversation' });
  }
});

module.exports = router;
