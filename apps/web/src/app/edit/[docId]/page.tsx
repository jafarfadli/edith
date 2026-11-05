import { Editor } from "@/components/editor/Editor";

export default async function EditPage({ params, searchParams }: {
  params: Promise<{ docId: string }>;
  searchParams: Promise<{ name?: string | string[] }>;
}) {
  const { docId } = await params;
  const { name } = await searchParams;
  return <Editor docId={docId} initialName={(Array.isArray(name) ? name[0] : name) || "document.pdf"} />;
}
