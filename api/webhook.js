// ============================================================
// api/webhook.js — Webhook cho Make.com
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

LUÔN NHỚ:
- Trả lời như người thật, dùng "ạ" tự nhiên
- Không lan man, không dài dòng
- Luôn kết thúc bằng câu hỏi
- Mục tiêu cuối: CHỐT LỊCH`;

// Lưu lịch sử hội thoại theo senderId
const conversations = new Map();
const MAX_HISTORY = 20;

export default async function handler(req, res) {
  // Chỉ nhận POST từ Make.com
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { senderId, message } = req.body;

    // Validate input
    if (!senderId || !message) {
      return res.status(400).json({ error: 'Thiếu senderId hoặc message' });
    }

    // Lấy hoặc tạo lịch sử hội thoại
    if (!conversations.has(senderId)) {
      conversations.set(senderId, []);
    }
    const history = conversations.get(senderId);
    history.push({ role: 'user', content: message });

    // Giới hạn lịch sử
    while (history.length > MAX_HISTORY) history.shift();

    // Gọi Claude AI
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: history
      })
    });

    if (!response.ok) {
      throw new Error(`Anthropic error: ${response.status}`);
    }

    const data = await response.json();
    const reply = data.content?.map(b => b.text || '').join('') ||
      'Dạ bên mình chưa nhận được, bạn nhắn lại giúp mình nhé ạ?';

    // Lưu lại reply vào history
    history.push({ role: 'assistant', content: reply });
    conversations.set(senderId, history);

    // Trả về cho Make.com
    return res.status(200).json({ reply });

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(200).json({
      reply: 'Dạ hệ thống đang bận, bạn nhắn lại sau ít phút nhé ạ 🙏'
    });
  }
}
