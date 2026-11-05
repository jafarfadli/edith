import { Editor } from "@/components/editor/Editor";

export default async function EditPage({ params, searchParams }: {
  params: Promise<{ docId: string }>;
  searchParams: Promise<{ name?: string }>;
}) {
  const { docId } = await params;
  const { name } = await searchParams;
  return <Editor docId={docId} initialName={name ?? "document.pdf"} />;
}
