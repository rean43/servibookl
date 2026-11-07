import { auth, db } from './firebase-config.js';
import {
    addDoc, collection, doc, getDoc, getDocs, onSnapshot, orderBy, or, query,
    serverTimestamp, updateDoc, where,
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
}[char]));

function formatTime(value) {
    const date = value?.toDate ? value.toDate() : (value ? new Date(value) : null);
    return date && !Number.isNaN(date.getTime())
        ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
}

/** Subscribe to an authorized conversation's messages; return the unsubscribe handle. */
export function subscribeToMessages(conversationId, currentUserId, renderMessages, onError = console.error) {
    if (!conversationId || !currentUserId || typeof renderMessages !== 'function') {
        throw new TypeError('conversationId, currentUserId, and renderMessages are required.');
    }
    const messagesQuery = query(
        collection(db, 'conversations', String(conversationId), 'messages'),
        orderBy('createdAt', 'asc'),
    );
    return onSnapshot(messagesQuery, (snapshot) => {
        const messages = snapshot.docs.map((messageDoc) => {
            const data = messageDoc.data();
            return {
                id: messageDoc.id,
                message: data.text ?? data.message ?? '',
                sender_name: data.senderName ?? data.sender_name ?? 'User',
                is_mine: data.senderId === currentUserId,
                created_at: data.createdAt ?? data.timestamp,
            };
        });
        renderMessages(messages);
    }, onError);
}

export async function sendMessage(conversationId, senderId, receiverId, senderName, text) {
    const cleanText = String(text ?? '').trim();
    if (!conversationId || !senderId || !receiverId || !cleanText) throw new Error('A conversation, sender, recipient, and message are required.');
    if (cleanText.length > 1000) throw new Error('Messages must be 1,000 characters or fewer.');
    try {
        await addDoc(collection(db, 'conversations', String(conversationId), 'messages'), {
            senderId,
            receiverId,
            senderName: senderName || 'User',
            text: cleanText,
            createdAt: serverTimestamp(),
        });
        await updateDoc(doc(db, 'conversations', String(conversationId)), {
            lastMessage: cleanText,
            updatedAt: serverTimestamp(),
        });
    } catch (error) {
        console.error('Unable to send chat message:', error);
        throw error;
    }
}

const root = document.getElementById('servibookChat');
if (root) {
    const byId = (id) => document.getElementById(id);
    const toggleBtn = byId('chatToggle'), panel = byId('chatPanel'), closeBtn = byId('chatClose');
    const messagesEl = byId('chat-messages-body') || byId('chatMessages');
    const form = byId('chat-form') || byId('chatForm');
    const input = byId('chat-input') || byId('chatInput');
    const sendButton = byId('send-btn') || form?.querySelector('[type="submit"]');
    const titleEl = byId('chatTitle'), subtitleEl = byId('chatSubtitle'), listEl = byId('chatConversationList');
    const urlParams = new URLSearchParams(window.location.search);
    let conversationId = urlParams.get('cid') || root.dataset.conversationId || null;
    let activeConversation = null;
    let unsubscribeMessages = null;
    let unsubscribeConversations = [];
    let conversationsByRole = [];
    let conversationsByParticipants = [];

    function stopConversationListeners() {
        unsubscribeConversations.forEach((unsubscribe) => unsubscribe?.());
        unsubscribeConversations = [];
    }

    function makeConversationSummary(item, userId) {
        const data = item.data();
        const partnerId = data.customerId === userId
            ? data.providerId
            : data.providerId === userId ? data.customerId
                : (data.participants || []).find((id) => id !== userId);
        const partnerName = data.customerId === userId
            ? data.providerName || data.partnerNames?.[userId] || data.partnerName || 'Provider'
            : data.providerId === userId
                ? data.customerName || data.partnerNames?.[userId] || data.partnerName || 'Customer'
                : data.partnerNames?.[userId] || data.partnerName || 'Conversation';
        return { id: item.id, ...data, partnerId, partnerName };
    }

    function renderConversationList(userId) {
        if (!listEl) return;
        const merged = new Map();
        [...conversationsByRole, ...conversationsByParticipants].forEach((item) => merged.set(item.id, item));
        const conversations = [...merged.values()].map((item) => makeConversationSummary(item, userId));
        conversations.sort((a, b) => {
            const timeA = a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0;
            const timeB = b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
            return timeB - timeA;
        });
        if (!conversations.length) {
            listEl.innerHTML = '<div class="chat-empty">No conversations yet. Choose Message Provider on a service to start one.</div>';
            return;
        }

        const buttons = conversations.map((item) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `chat-conversation-item ${item.id === conversationId ? 'active' : ''}`;
            const name = document.createElement('strong');
            name.textContent = item.partnerName;
            const lastMessage = document.createElement('span');
            lastMessage.textContent = item.lastMessage || 'Start chatting';
            button.append(name, lastMessage);
            button.addEventListener('click', () => {
                activeConversation = item;
                titleEl.textContent = item.partnerName;
                subtitleEl.textContent = 'Live chat';
                watchConversation(item.id);
                renderConversationList(userId);
            });
            return button;
        });
        listEl.replaceChildren(...buttons);
        if (conversationId && !activeConversation) {
            activeConversation = conversations.find((item) => item.id === conversationId) || null;
            if (activeConversation) {
                titleEl.textContent = activeConversation.partnerName;
                subtitleEl.textContent = 'Live chat';
            }
        }
    }

    function scrollMessagesToBottom(behavior = 'smooth') {
        if (!messagesEl) return;
        messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior });
    }

    function renderMessages(messages) {
        const previousScrollTop = messagesEl.scrollTop;
        const wasNearBottom = messagesEl.scrollHeight - messagesEl.clientHeight - previousScrollTop <= 80;
        if (!messages.length) {
            messagesEl.innerHTML = '<div class="chat-empty">No messages yet. Say hello!</div>';
            if (wasNearBottom) requestAnimationFrame(() => scrollMessagesToBottom());
            return;
        }
        messagesEl.innerHTML = messages.map((message) => `
            <div class="chat-message ${message.is_mine ? 'mine' : 'theirs'}"><div class="chat-bubble">
                ${!message.is_mine ? `<span class="chat-sender">${escapeHtml(message.sender_name)}</span>` : ''}
                <p>${escapeHtml(message.message)}</p><time>${formatTime(message.created_at)}</time>
            </div></div>`).join('');
        if (wasNearBottom) requestAnimationFrame(() => scrollMessagesToBottom());
        else messagesEl.scrollTop = previousScrollTop;
    }

    function watchConversation(id) {
        unsubscribeMessages?.();
        unsubscribeMessages = null;
        conversationId = id ? String(id) : null;
        const canSend = Boolean(conversationId && auth.currentUser);
        if (input) input.disabled = !canSend;
        if (sendButton) sendButton.disabled = !canSend;
        if (input) input.placeholder = canSend ? 'Type a message...' : 'Choose a conversation to message...';
        if (!conversationId || !auth.currentUser) {
            messagesEl.innerHTML = '<div class="chat-empty">Choose a conversation or use “Message Provider” on a service to start one.</div>';
            return;
        }
        messagesEl.innerHTML = '<div class="chat-empty">Loading messages…</div>';
        unsubscribeMessages = subscribeToMessages(conversationId, auth.currentUser.uid, renderMessages,
            (error) => { console.error('Unable to load messages:', error); messagesEl.innerHTML = '<div class="chat-empty">Unable to load messages.</div>'; });
    }

    function loadConversations() {
        if (!listEl || !auth.currentUser) return;
        stopConversationListeners();
        const userId = auth.currentUser.uid;
        const roleQuery = query(collection(db, 'conversations'), or(
            where('customerId', '==', userId),
            where('providerId', '==', userId),
        ));
        const legacyQuery = query(collection(db, 'conversations'), where('participants', 'array-contains', userId));
        unsubscribeConversations = [
            onSnapshot(roleQuery, (snapshot) => {
                conversationsByRole = snapshot.docs;
                renderConversationList(userId);
            }, (error) => console.error('Unable to load conversations:', error)),
            onSnapshot(legacyQuery, (snapshot) => {
                conversationsByParticipants = snapshot.docs;
                renderConversationList(userId);
            }, (error) => console.error('Unable to load legacy conversations:', error)),
        ];
    }

    function setPanelOpen(open) {
        panel.classList.toggle('hidden', !open); toggleBtn.classList.toggle('active', open);
        toggleBtn.setAttribute('aria-expanded', String(open));
        panel.setAttribute('aria-hidden', String(!open));
        if (open) { loadConversations(); watchConversation(conversationId); } else {
            unsubscribeMessages?.(); unsubscribeMessages = null;
            stopConversationListeners();
            toggleBtn.focus();
        }
    }

    window.openServibookChat = async (options = {}) => {
        // Conversation documents must be provisioned with Firebase UID participants.
        if (options.conversationId) {
            conversationId = String(options.conversationId);
            titleEl.textContent = options.partnerName || 'Chat'; subtitleEl.textContent = 'Live chat';
        } else if (options.providerId) {
            if (!auth.currentUser) { alert('Please sign in to message a provider.'); return false; }
            let operation = 'checking provider conversation';
            try {
                // Booking documents store providerId as the provider's Firebase Auth UID.
                const providerUid = String(options.providerId).trim();
                const providerName = options.partnerName || 'Provider';
                const customerId = auth.currentUser.uid;
                const customerName = auth.currentUser.displayName || 'Customer';
                if (!providerUid) throw new Error('This booking does not have a provider account ID.');
                if (providerUid === customerId) throw new Error('You cannot start a conversation with yourself.');

                // Keep the lookup to one indexed field; the customerId constraint
                // also lets Firestore Rules prove that the caller is a participant.
                let existing = null;
                try {
                    const customerConversations = await getDocs(query(
                        collection(db, 'conversations'),
                        where('customerId', '==', customerId),
                    ));
                    existing = customerConversations.docs.find((item) => item.data().providerId === providerUid) || null;
                } catch (queryError) {
                    if (queryError.code !== 'permission-denied' && !queryError.message?.includes('index')) throw queryError;
                    console.warn('Role-field conversation lookup was denied; trying legacy participant records.');
                }
                if (!existing) {
                    try {
                        const legacySnapshot = await getDocs(query(
                            collection(db, 'conversations'),
                            where('participants', 'array-contains', customerId),
                        ));
                        existing = legacySnapshot.docs.find((item) => item.data().participants?.includes(providerUid)) || null;
                    } catch (legacyError) {
                        if (legacyError.code !== 'permission-denied' && !legacyError.message?.includes('index')) throw legacyError;
                        console.warn('Legacy conversation lookup was unavailable; attempting to create a conversation.', legacyError);
                    }
                }
                if (existing) {
                    conversationId = existing.id;
                    activeConversation = { id: existing.id, ...existing.data(), partnerName: providerName };
                }
                else {
                    operation = 'creating provider conversation';
                    const created = await addDoc(collection(db, 'conversations'), {
                        customerId,
                        customerName,
                        providerId: providerUid,
                        providerName,
                        participants: [customerId, providerUid],
                        partnerNames: { [customerId]: providerName, [providerUid]: customerName },
                        lastMessage: 'Started a conversation',
                        updatedAt: serverTimestamp(),
                        serviceId: options.serviceId ?? null,
                        createdAt: serverTimestamp(),
                    });
                    conversationId = created.id;
                    activeConversation = {
                        id: created.id, customerId, customerName, providerId: providerUid,
                        providerName, participants: [customerId, providerUid], partnerName: providerName,
                    };
                }
                titleEl.textContent = providerName; subtitleEl.textContent = 'Live chat';
            } catch (error) {
                console.error(`Unable to open provider conversation while ${operation}:`, error);
                alert(error.code === 'permission-denied'
                    ? 'Chat is unavailable right now. Please try again later.'
                    : error.message || 'Unable to open chat.');
                return false;
            }
        }
        setPanelOpen(true);
        input?.focus();
        return true;
    };
    toggleBtn?.addEventListener('click', () => setPanelOpen(panel.classList.contains('hidden')));
    closeBtn?.addEventListener('click', () => setPanelOpen(false));
    panel?.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !panel.classList.contains('hidden')) setPanelOpen(false);
    });
    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!auth.currentUser) { alert('Please sign in to send messages.'); return; }
        if (!conversationId) {
            messagesEl.innerHTML = '<div class="chat-empty">Choose a conversation or use “Message Provider” on a service to start one.</div>';
            return;
        }
        const text = input.value.trim(); if (!text) return;
        const currentUserId = auth.currentUser.uid;
        if (!activeConversation || activeConversation.id !== conversationId) {
            try {
                const conversationDoc = await getDoc(doc(db, 'conversations', conversationId));
                if (conversationDoc.exists()) activeConversation = { id: conversationDoc.id, ...conversationDoc.data() };
            } catch (error) {
                console.error('Could not load conversation participants:', error);
                alert('Unable to send the message. Conversation details could not be loaded.');
                return;
            }
        }
        const receiverId = activeConversation?.customerId === currentUserId
            ? activeConversation.providerId
            : activeConversation?.providerId === currentUserId
                ? activeConversation.customerId
                : activeConversation?.participants?.find((id) => id !== currentUserId);
        if (!receiverId) { alert('The other conversation participant could not be found.'); return; }
        input.value = '';
        try {
            await sendMessage(conversationId, currentUserId, receiverId, auth.currentUser.displayName || 'User', text);
            requestAnimationFrame(() => scrollMessagesToBottom());
        }
        catch (error) {
            if (!input.value) input.value = text;
            alert(error.message || 'Unable to send message.');
        }
        input.focus();
    });
    if (conversationId) { titleEl.textContent = root.dataset.partnerName || 'Chat'; subtitleEl.textContent = 'Live chat'; }

    onAuthStateChanged(auth, (user) => {
        if (!user) {
            unsubscribeMessages?.(); unsubscribeMessages = null;
            stopConversationListeners();
            if (input) input.disabled = true;
            if (sendButton) sendButton.disabled = true;
            return;
        }
        if (!panel.classList.contains('hidden')) {
            loadConversations();
            watchConversation(conversationId);
        }
        if (urlParams.get('cid')) setPanelOpen(true);
    }, (error) => console.error('Chat auth state failed:', error));
}

