import type { Metadata } from "next";
import { VoiceStudio } from "@/components/voice/studio";

export const metadata: Metadata = { title: "Voice Agent Hub" };

export default function VoiceHubPage() {
  return <VoiceStudio />;
}
