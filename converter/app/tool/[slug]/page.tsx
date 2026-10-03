import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ConverterPanel from "@/components/ConverterPanel";
import { TOOLS, getTool } from "@/lib/tools";

export function generateStaticParams() {
  return TOOLS.map((tool) => ({ slug: tool.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tool = getTool(slug);
  if (!tool) return { title: "Tool not found" };
  return {
    title: tool.title,
    description: tool.description,
    alternates: { canonical: `/tool/${tool.slug}` },
  };
}

export default async function ToolPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tool = getTool(slug);
  if (!tool) notFound();

  const related = TOOLS.filter(
    (t) => t.category === tool.category && t.slug !== tool.slug,
  ).slice(0, 3);

  return (
    <div className="tool-wrap">
      <div className="crumb">
        <Link href="/">Home</Link> › <span>{tool.category}</span> › {tool.title}
      </div>

      <div className="tool-head">
        <div className="icon" style={{ background: tool.accent }}>
          {tool.icon}
        </div>
        <div>
          <h1>{tool.title}</h1>
          <p>{tool.description}</p>
        </div>
      </div>

      <ConverterPanel tool={tool} />

      {related.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Related tools</h2>
          </div>
          <div className="grid">
            {related.map((item) => (
              <Link className="card" key={item.slug} href={`/tool/${item.slug}`}>
                <div className="icon" style={{ background: item.accent }}>
                  {item.icon}
                </div>
                <h3>{item.title}</h3>
                <p>{item.short}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
