import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ToolRunner } from "@/components/tools/ToolRunner";
import { t } from "@/lib/strings";
import { TOOLS, toolBySlug } from "@/lib/tools";

export function generateStaticParams() {
  return TOOLS.map(({ slug }) => ({ tool: slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ tool: string }> }): Promise<Metadata> {
  const item = t.tools.items[(await params).tool];
  return item ? { title: `${item.name} — Edith`, description: item.desc } : {};
}

export default async function ToolPage({ params }: { params: Promise<{ tool: string }> }) {
  const tool = toolBySlug((await params).tool);
  if (!tool) notFound();
  return <ToolRunner tool={tool} />;
}
