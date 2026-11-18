export async function read() {
  return Bun.file("fixture.txt").text();
}
