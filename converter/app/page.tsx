import Link from "next/link";
import { CATEGORIES, TOOLS } from "@/lib/tools";

export default function HomePage() {
  return (
    <div className="shell">
      <section className="hero">
        <h1>
          Every file converter you need,
          <br />
          <span className="grad">in one place.</span>
        </h1>
        <p>
          Convert PDF to Word or Excel, turn documents and images into PDF, merge,
          split, compress, rotate and run OCR on scans — fast, free and without
          installing anything.
        </p>
        <div className="badges">
          <span className="badge">{TOOLS.length} tools</span>
          <span className="badge">No sign-up</span>
          <span className="badge">Files never stored</span>
          <span className="badge">Urdu &amp; English OCR</span>
          <span className="badge">Up to 100 MB</span>
        </div>
      </section>

      <div id="all-tools" />

      {CATEGORIES.map((category) => {
        const tools = TOOLS.filter((t) => t.category === category);
        return (
          <section className="section" key={category}>
            <div className="section-head">
              <h2>{category}</h2>
              <span>{tools.length} tools</span>
            </div>
            <div className="grid">
              {tools.map((tool) => (
                <Link className="card" key={tool.slug} href={`/tool/${tool.slug}`}>
                  <div className="icon" style={{ background: tool.accent }}>
                    {tool.icon}
                  </div>
                  <h3>{tool.title}</h3>
                  <p>{tool.description}</p>
                  <span className="tag">{tool.short}</span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      <section className="section">
        <div className="section-head">
          <h2>How it works</h2>
        </div>
        <div className="how">
          <div className="step">
            <b>1</b>
            <h3>Pick a tool</h3>
            <p>Choose the conversion you need from the list above.</p>
          </div>
          <div className="step">
            <b>2</b>
            <h3>Drop your file</h3>
            <p>
              Drag and drop, or browse. Several files at once for merge, image and
              batch tools.
            </p>
          </div>
          <div className="step">
            <b>3</b>
            <h3>Adjust the settings</h3>
            <p>
              Resolution, quality, page ranges and page size — sensible defaults are
              already set.
            </p>
          </div>
          <div className="step">
            <b>4</b>
            <h3>Download</h3>
            <p>
              The converted file is returned straight away. Nothing is kept on the
              server afterwards.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
