// src/api/mockApi.js

// ---------- helpers ----------
function delay(ms) { return new Promise(res => setTimeout(res, ms)); }
function newid(p = "id") { return `${p}_${Math.random().toString(36).slice(2,9)}`; }

// ensure unique conversation ids if duplicates are present
function ensureUniqueConversationIds(list) {
  const seen = new Map(); // id -> count
  return list.map(conv => {
    const base = conv.id ?? `c_${conv.phone ?? newid("c")}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    const id = count === 1 ? base : `${base}-${count}`;
    return { ...conv, id };
  });
}

// ensure every conversation has a messages array entry
function ensureMessagesForAll(convs, messages) {
  const out = { ...messages };
  for (const c of convs) {
    if (!out[c.id]) out[c.id] = [];
  }
  return out;
}

// ---------- seed data (edit/extend freely) ----------
let seededConversations = [
  {
    id: "c1",
    phone: "+51 915 944 684",
    lastMessage: "-",
    lastTimestamp: "2025-10-21T19:35:48.780Z",
    unread: 1
  },
  {
    id: "c2",
    phone: "+51 941 196 497",
    lastMessage: "ter",
    lastTimestamp: "2025-10-22T21:29:12.125Z",
    unread: 1
  }
]


let seededMessages = {
  c1: [
    {
      d: "68f7dc1c4d8e1b21f5ea268d-c0",
      chatId: "68f7dc1c4d8e1b21f5ea268d",
      from: "them",
      type: "text",
      text: "1423",
      timestamp: "2025-10-21T19:18:08.589Z"
    },
    {
      d: "68f7dc1c4d8e1b21f5ea268d-c1",
      chatId: "68f7dc1c4d8e1b21f5ea268d",
      from: "them",
      type: "text",
      text: "142132",
      timestamp: "2025-10-21T19:18:19.556Z"
    },
    {
      d: "68f7dc1c4d8e1b21f5ea268d-c2",
      chatId: "68f7dc1c4d8e1b21f5ea268d",
      from: "them",
      type: "text",
      text: "123",
      timestamp: "2025-10-21T19:18:20.390Z"
    },
    {
      d: "68f7dc1c4d8e1b21f5ea268d-c3",
      chatId: "68f7dc1c4d8e1b21f5ea268d",
      from: "them",
      type: "text",
      text: "-",
      timestamp: "2025-10-21T19:35:48.780Z"
    },
    {
      d: "68f7dc1c4d8e1b21f5ea268d-m0",
      chatId: "68f7dc1c4d8e1b21f5ea268d",
      from: "me",
      type: "text",
      text: null,
      timestamp: "2025-10-21T19:16:44.753Z"
    }
  ],
  c2: [
    {
      d: "68f7dc9045bdf37f3889912d-c0",
      chatId: "68f7dc9045bdf37f3889912d",
      from: "them",
      type: "text",
      text: "959 887 588",
      timestamp: "2025-10-22T14:18:09.861Z"
    },
    {
      d: "68f7dc9045bdf37f3889912d-c1",
      chatId: "68f7dc9045bdf37f3889912d",
      from: "them",
      type: "text",
      text: "123",
      timestamp: "2025-10-22T21:29:11.374Z"
    },
    {
      d: "68f7dc9045bdf37f3889912d-c2",
      chatId: "68f7dc9045bdf37f3889912d",
      from: "them",
      type: "text",
      text: "ter",
      timestamp: "2025-10-22T21:29:12.125Z"
    },
    {
      d: "68f7dc9045bdf37f3889912d-m0",
      chatId: "68f7dc9045bdf37f3889912d",
      from: "me",
      type: "text",
      text: "Hola 👋🏼 ¿Cómo estás?",
      timestamp: "2025-10-21T19:18:40.370Z"
    }
  ]
}

// ---------- sanitize seeds once ----------
seededConversations = ensureUniqueConversationIds(seededConversations);
seededMessages = ensureMessagesForAll(seededConversations, seededMessages);

// ---------- public API (used by src/api/index.js) ----------
export async function fetchConversations() {
  await delay(150);
  return JSON.parse(JSON.stringify(seededConversations));
}

export async function fetchMessages(chatId) {
  await delay(150);
  return JSON.parse(JSON.stringify(seededMessages[chatId] || []));
}

export async function sendText({ to, text }) {
  await delay(100);
  return { id: newid("srv"), timestamp: new Date().toISOString() };
}

export async function sendImage({ to, file }) {
  await delay(120);
  const imageUrl = URL.createObjectURL(file);
  return { id: newid("srv"), timestamp: new Date().toISOString(), imageUrl };
}
