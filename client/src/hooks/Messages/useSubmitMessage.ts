import { useCallback, useRef } from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { replaceSpecialVars, QueryKeys } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import { useChatContext, useChatFormContext, useAddedChatContext } from '~/Providers';
import { useAuthContext } from '~/hooks/AuthContext';
import store from '~/store';

export default function useSubmitMessage() {
  const { user, token } = useAuthContext();
  const { conversationId } = useParams();
  const queryClient = useQueryClient();
  const methods = useChatFormContext();
  const { conversation: addedConvo } = useAddedChatContext();
  const { ask, index, getMessages, setMessages, latestMessage } = useChatContext();

  const autoSendPrompts = useRecoilValue(store.autoSendPrompts);
  const setActivePrompt = useSetRecoilState(store.activePromptByIndex(index));
  const setLatestMessage = useSetRecoilState(store.latestMessageFamily(index));
  const setCompactionArmed = useSetRecoilState(store.compactionArmed);

  // Refs to always hold the latest functions (avoids stale closure after state updates)
  const askRef = useRef(ask);
  askRef.current = ask;
  const addedConvoRef = useRef(addedConvo);
  addedConvoRef.current = addedConvo;

  const submitMessage = useCallback(
    async (data?: { text: string }) => {
      if (!data) {
        return console.warn('No data provided to submitMessage');
      }

      // Read armed state from localStorage (avoids stale Recoil closure)
      const armed = localStorage.getItem('compaction_armed');
      if (armed && armed === conversationId && token) {
        try {
          localStorage.removeItem('compaction_armed');
          setCompactionArmed(null);

          const res = await fetch(`/api/conversations/${conversationId}/compact`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ skipLastUser: true }),
          });
          const result = await res.json();

          if (result.success && result.newMessages) {
            // Update React Query cache directly (bypasses the "fewer messages" safety check)
            const compactedMsgs = result.newMessages as TMessage[];
            queryClient.setQueryData([QueryKeys.messages, conversationId], compactedMsgs);

            // Update Recoil state so ask() uses the correct parentMessageId
            setMessages(compactedMsgs);
            const ackMsg = compactedMsgs[compactedMsgs.length - 1];
            setLatestMessage(ackMsg);

            // Submit user's message after React processes state updates
            const textToSend = data.text;
            methods.reset();
            requestAnimationFrame(() => {
              askRef.current(
                { text: textToSend },
                { addedConvo: addedConvoRef.current ?? undefined },
              );
            });
            return;
          }
        } catch {
          // Compact error — fall through to normal send
        }
      }

      // Normal submission
      const rootMessages = getMessages();
      const isLatestInRootMessages = rootMessages?.some(
        (message) => message.messageId === latestMessage?.messageId,
      );
      if (!isLatestInRootMessages && latestMessage) {
        setMessages([...(rootMessages || []), latestMessage]);
      }

      ask(
        {
          text: data.text,
        },
        {
          addedConvo: addedConvo ?? undefined,
        },
      );
      methods.reset();
    },
    [
      ask,
      methods,
      addedConvo,
      setMessages,
      getMessages,
      latestMessage,
      setLatestMessage,
      conversationId,
      token,
      queryClient,
    ],
  );

  const submitPrompt = useCallback(
    (text: string) => {
      const parsedText = replaceSpecialVars({ text, user });
      if (autoSendPrompts) {
        submitMessage({ text: parsedText });
        return;
      }

      const currentText = methods.getValues('text');
      const newText = currentText.trim().length > 1 ? `\n${parsedText}` : parsedText;
      setActivePrompt(newText);
    },
    [autoSendPrompts, submitMessage, setActivePrompt, methods, user],
  );

  return { submitMessage, submitPrompt };
}
