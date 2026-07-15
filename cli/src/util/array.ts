export function zip<A, B>(a: A[], b: B[]): [A, B][] {
  return a.map((a, idx) => {
    return [a, b[idx] as B]
  })
}
