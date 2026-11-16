"use client";

import { useEffect, useState } from "react";

/** The "D" of "PDF" as a sheet of paper cut to the letter's shape, with a line of a letter on it being edited: a word
 *  is selected, deleted and typed anew, over and over. What Edith does, shown on the headline itself. */

const WORDS = ["Senin", "Kamis", "Jumat"];

type Phase = "rest" | "select" | "type";

export function PaperLetter() {
  const [word, setWord] = useState(0);
  const [phase, setPhase] = useState<Phase>("rest");
  const [typed, setTyped] = useState(WORDS[0].length);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer: ReturnType<typeof setTimeout>;
    let w = 0;
    let n = 0;
    const rest = () => { setPhase("rest"); timer = setTimeout(select, 2200); };
    const select = () => {
      setPhase("select");
      timer = setTimeout(() => { w = (w + 1) % WORDS.length; n = 0; setWord(w); setTyped(0); setPhase("type"); timer = setTimeout(type, 260); }, 700);
    };
    const type = () => {
      n += 1;
      setTyped(n);
      timer = n >= WORDS[w].length ? setTimeout(rest, 140) : setTimeout(type, 110);
    };
    timer = setTimeout(select, 2400);
    return () => clearTimeout(timer);
  }, []);

  const text = WORDS[word].slice(0, typed);
  return (
    <span aria-hidden
      className="paper-letter relative mx-[0.04em] inline-flex h-[0.74em] w-[1.06em] -translate-y-[0.26em] rotate-[-4deg] flex-col justify-center gap-[0.055em] rounded-r-full bg-paper pl-[0.12em] pr-[0.3em] align-baseline shadow-sheet">
      <span className="h-[0.035em] w-[60%] rounded-full bg-paper-ink/25" />
      <span className="h-[0.035em] w-[85%] rounded-full bg-paper-ink/25" />
      <span className="flex items-center whitespace-nowrap font-sans text-[0.105em] font-medium leading-none tracking-normal text-paper-ink">
        <span className="opacity-60">Hari&nbsp;</span>
        <span className={`rounded-[2px] px-[1px] transition-colors duration-150 ${phase === "select" ? "bg-accent" : ""}`}>{text}</span>
        <span className={`ml-px inline-block h-[1.15em] w-[1.5px] bg-paper-ink ${phase === "type" ? "" : "caret-blink"}`} />
      </span>
      <span className="h-[0.035em] w-[72%] rounded-full bg-paper-ink/25" />
      <span className="h-[0.035em] w-[40%] rounded-full bg-paper-ink/25" />
    </span>
  );
}
