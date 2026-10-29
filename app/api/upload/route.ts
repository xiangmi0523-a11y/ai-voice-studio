import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

// Issues short-lived tokens so the phone uploads straight to Blob,
// avoiding the 4.5 MB request limit of Vercel functions. Protected by proxy.ts.
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith("uploads/")) throw new Error("上传路径不对");
        return {
          allowedContentTypes: ["audio/*", "video/mp4", "video/webm", "application/zip"],
          maximumSizeInBytes: 500 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
