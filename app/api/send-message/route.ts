import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { sendText } from "@/lib/zapi";

// Manual message sending from dashboard (human agent)
export async function POST(req: NextRequest) {
  try {
    const { conversationId, message } = await req.json();

    if (!conversationId || !message) {
      return NextResponse.json(
        { error: "conversationId and message are required" },
        { status: 400 }
      );
    }

    const supabase = getSupabase();

    // Get conversation
    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .select("*")
      .eq("id", conversationId)
      .single();

    if (convError || !conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    // Send via Z-API
    await sendText(conversation.phone, message);

    // Save message
    await supabase.from("messages").insert({
      conversation_id: conversation.id,
      lead_id: conversation.lead_id,
      direction: "outgoing",
      content: message,
      message_type: "text",
      is_from_bot: false,
    });

    // Update conversation
    await supabase
      .from("conversations")
      .update({
        last_message_at: new Date().toISOString(),
        messages_count: (conversation.messages_count || 0) + 1,
      })
      .eq("id", conversation.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[SendMessage] Error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
