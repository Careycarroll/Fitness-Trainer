/**
 * Patterns with zero catalog rows until their milestone lands.
 *
 * This is a DECLARATION, not a relaxation. Every other pattern is still held to
 * the full ADR-008 bar of >= 2 options, and the full ADR-013 bar of >= 2 on
 * home-garage. An entry here must name the milestone that removes it.
 *
 * Per ADR-007 this is the mechanical exit criterion for that milestone: when
 * M7 lands, deleting the entry has to make the build pass, or M7 is not done.
 *
 * Checks 05 and 11 both import this. They must defer the same set — a pattern
 * skipped by one and enforced by the other produces a failure whose message
 * does not explain itself.
 */
export const DEFERRED_PATTERNS = {
};

export const isDeferred = (p) => p in DEFERRED_PATTERNS;
