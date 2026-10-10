import type { Metadata } from "next";
import { ChatStudio } from "@/components/chat/studio";

export const metadata: Metadata = { title: "Text Chat Studio" };

export default function ChatStudioPage() {
  return <ChatStudio />;
}
