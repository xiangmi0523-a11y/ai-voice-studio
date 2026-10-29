import Studio from "@/components/Studio";
import { configStatus } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function Home() {
  return <Studio initialConfig={configStatus()} />;
}
