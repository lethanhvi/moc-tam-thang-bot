// ============================================================
// api/webhook.js — Facebook Messenger Webhook
// Spa Mộc Tâm Thang · Powered by Claude AI
// ============================================================

const SYSTEM_PROMPT = `Bạn là nhân viên tư vấn tại Spa dưỡng sinh Đông y Mộc Tâm Thang.

MỤC TIÊU:
- Hiểu tình trạng khách hàng
- Tư vấn ngắn gọn, dễ hiểu
- Luôn dẫn dắt khách đến việc đặt lịch

PHONG CÁCH:
- Nhẹ nhàng, thân thiện, lịch sự
- Giống người thật (không máy móc)
- Trả lời ngắn gọn (3–5 dòng)
- Không dùng từ chuyên môn phức tạp

QUY TẮC BẮT BUỘC:
1. LUÔN hỏi lại để hiểu tình trạng
2. KHÔNG trả lời dài dòng
3. KHÔNG lan man
4. KHÔNG báo giá ngay nếu chưa hiểu rõ
5. LUÔN kết thúc bằng câu hỏi
6. MỤC TIÊU CUỐI: dẫn đến đặt lịch

FLOW BẮT BUỘC:
BƯỚC 1: Hỏi tình trạng → "Bạn đang gặp tình trạng gì ạ?"
BƯỚC 2: Đồng cảm + giải thích nhẹ → "Tình trạng này bên mình gặp khá nhiều…"
BƯỚC 3: Giải pháp → massage thông kinh lạc + dưỡng sinh Đông y
BƯỚC 4: CHỐT → "Mình bị lâu chưa ạ?" HOẶC "Mình rảnh khung giờ nào để bên mình giữ lịch ạ?"

XỬ LÝ ĐẶC BIỆT:
❖ Nếu hỏi GIÁ: "Dạ bên mình sẽ tư vấn theo tình trạng cụ thể để đạt hiệu quả tốt nhất ạ. Bạn đang gặp tình trạng nào để bên mình tư vấn chính xác hơn nhé?"
❖ Nếu trả lời ngắn: hỏi lại để kéo hội thoại
❖ Nếu hỏi lan man: kéo về tình trạng + chốt

THÔNG TIN SPA:
- Chuyên: dưỡng sinh Đông y, massage trị liệu, gội đầu dưỡng sinh
- Giúp: giảm đau, thư giãn, ngủ ngon
- Nhiều khách cải thiện sau 1–2 buổi
- Địa chỉ: Quảng Ngãi
- Không gian yên tĩnh, riêng tư

LUÔN NHỚ:
- Trả lời như người thật, dùng "ạ" tự nhiên cuối câu
- Không lan man, không dài dòng
- Luôn dẫn dắt và kết thúc bằng câu hỏi
- Mục tiêu cuối: CHỐT LỊCH`;

// In-memory conversation store (resets on cold start, good enough for Vercel)
// For production, replace with KV / Redis / Upstash
const conversations = new Map();

// Giới hạn lịch sử: giữ tối đa 10 lượt (20 messages) để tránh tốn token
const MAX_HISTORY = 20;

// ── GET: Facebook webhook verification ──────────────────
function handleVerify(req, res) {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.FB_VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    return res.status(200).send(challenge);
  }
  console.warn('❌ Verify failed', { mode, token });
  return res.status(403).send('Forbidden');
}

// ── POST: receive messages ───────────────────────────────
async function handleMessage(req, res) {
  // Facebook expects 200 quickly
  res.status(200).send('EVENT_RECEIVED');

  const body = req.body;
  if (body.object !== 'page') return;

  for (const entry of body.entry || []) {
    for (const event of entry.messaging || []) {
      if (!event.message?.text) continue;  // ignore non-text (stickers, etc.)
      if (event.message.is_echo) continue; // ignore echoes from Page itself

      const senderId = event.sender.id;
      const userText = event.message.text.trim();

      console.log(`📩 [${senderId}] ${userText}`);

      try {
        const reply = await getAIReply(senderId, userText);
        await sendFBMessage(senderId, reply);
      } catch (err) {
        console.error('Error processing message:', err);
        await sendFBMessage(senderId, 'Dạ hệ thống đang bận, bạn nhắn lại sau ít phút nhé ạ 🙏');
      }
    }
  }
}

// ── AI reply via Anthropic ───────────────────────────────
async function getAIReply(senderId, userText) {
  // Load or create conversation history
  if (!conversations.has(senderId)) {
    conversations.set(senderId, []);
  }
  const history = conversations.get(senderId);

  history.push({ role: 'user', content: userText });

  // Trim if too long
  while (history.length > MAX_HISTORY) history.shift();

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', // Haiku: nhanh + rẻ, đủ dùng cho tư vấn
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: history
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error: ${response.status} ${err}`);
  }

  const data = await response.json();
  const reply = data.content?.map(b => b.text || '').join('') || 
    'Dạ bên mình chưa nhận được thông tin, bạn nhắn lại giúp mình nhé ạ?';

  history.push({ role: 'assistant', content: reply });
  conversations.set(senderId, history);

  return reply;
}

// ── Send message back to Facebook ───────────────────────
async function sendFBMessage(recipientId, text) {
  // Facebook giới hạn 2000 ký tự/tin — tự cắt nếu cần
  const safeText = text.length > 1900 
    ? text.substring(0, 1900) + '…' 
    : text;

  const res = await fetch(
    `https://graph.facebook.com/v19.0/me/messages?access_token=${process.env.FB_PAGE_ACCESS_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: safeText },
        messaging_type: 'RESPONSE'
      })
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.error('FB send error:', err);
  }
}

// ── Main handler (Vercel serverless) ────────────────────
export default async function handler(req, res) {
  if (req.method === 'GET')  return handleVerify(req, res);
  if (req.method === 'POST') return handleMessage(req, res);
  return res.status(405).send('Method Not Allowed');
}
