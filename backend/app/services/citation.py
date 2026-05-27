from __future__ import annotations

import re
from typing import Any


def replace_special_square_brackets(answer: str, sources: list[dict[str, Any]]) -> str:
    """
    Replace special square brackets like 【N】 with standard square brackets [[N]]
    so they can be processed and remapped.
    """
    left = "【"
    right = "】"
    pattern = re.escape(left) + r"(\d+)" + re.escape(right)

    def replacer(match: re.Match[str]) -> str:
        citation_num = int(match.group(1))
        if 1 <= citation_num <= len(sources):
            return f"[[{citation_num}]]"
        return match.group(0)

    return re.sub(pattern, replacer, answer)


def process_citations(
    answer: str,
    sources: list[dict[str, Any]],
) -> tuple[str, list[dict[str, Any]]]:
    """
    Processes citation numbers in the raw answer from the LLM, re-indexes them starting from 1..m
    for only the sources that are actually cited, and returns the renumbered answer and the list of cited sources.
    """
    # Replace special brackets first
    answer = replace_special_square_brackets(answer, sources)

    # Standard citations matches like [1], [2], etc. (but not within Markdown links already)
    citation_pattern = r"(?<!\[)\[(\d+)\](?!\]|\()"

    def replace_citation(match: re.Match[str]) -> str:
        citation_num = int(match.group(1))
        if 1 <= citation_num <= len(sources):
            return f"[[{citation_num}]]"
        return match.group(0)

    processed_answer = re.sub(citation_pattern, replace_citation, answer)

    try:
        # Find all cited numbers in the processed answer
        matches = re.findall(r"\[\[(\d+)\]\]", processed_answer)
        found_citations = set(int(m) for m in matches)

        # Filter to valid source indices
        valid_citations = sorted(n for n in found_citations if 1 <= n <= len(sources))

        if not valid_citations:
            # Revert any remaining [[n]] markers
            processed_answer = re.sub(r"\[\[(\d+)\]\]", r"[\1]", processed_answer)
            return processed_answer, []

        # Map filtered source objects
        sources_used = [sources[i - 1] for i in valid_citations]

        # Remap citation numbers to compact 1..m range
        replace_map = {old: new for new, old in enumerate(valid_citations, start=1)}

        # Two-pass replacement to avoid cascading replacements
        # Pass 1: Replace all citations with unique placeholders
        for old in valid_citations:
            placeholder = f"[[__CITE_{old}__]]"
            processed_answer = processed_answer.replace(f"[[{old}]]", placeholder)

        # Pass 2: Replace placeholders with final markdown link format
        for old, new in replace_map.items():
            placeholder = f"[[__CITE_{old}__]]"
            processed_answer = processed_answer.replace(placeholder, f"[[{new}]](#source-{new})")

        return processed_answer, sources_used

    except Exception:
        # Fallback: convert [[n]] back to standard [n]
        processed_answer = re.sub(r"\[\[(\d+)\]\]", r"[\1]", processed_answer)
        return processed_answer, sources
