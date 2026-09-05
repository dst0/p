type QdrantPointId = string | number;

interface QdrantFileVersionCleanupClient {
  scroll(
    collection: string,
    request: {
      offset?: QdrantPointId;
      limit: number;
      filter: {
        must: Array<{ key: string; match: { value: string } }>;
      };
      with_payload: true;
      with_vector: false;
    },
    signal?: AbortSignal,
  ): Promise<{
    points: Array<{ id: QdrantPointId; payload?: Record<string, unknown> }>;
    next_page_offset?: QdrantPointId | null;
  }>;
  deletePoints(collection: string, request: { wait: true; points: QdrantPointId[] }): Promise<void>;
}

const FILE_VERSION_SCROLL_PAGE_SIZE = 256;

export async function deleteObsoleteFileVersions(
  client: QdrantFileVersionCleanupClient,
  collection: string,
  repoId: string,
  fileId: string,
  keepFileHash: string,
): Promise<void> {
  const obsoletePointIds = new Set<QdrantPointId>();
  let offset: QdrantPointId | undefined;
  while (true) {
    const page = await client.scroll(
      collection,
      {
        ...(offset === undefined ? {} : { offset }),
        limit: FILE_VERSION_SCROLL_PAGE_SIZE,
        filter: {
          must: [
            { key: "repoId", match: { value: repoId } },
            { key: "fileId", match: { value: fileId } },
          ],
        },
        with_payload: true,
        with_vector: false,
      },
      undefined,
    );
    if (!Array.isArray(page.points)) throw new Error("Qdrant file-version cleanup returned an invalid point page");
    for (const point of page.points) {
      if (typeof point.id !== "string" && typeof point.id !== "number") {
        throw new Error("Qdrant file-version cleanup returned an invalid point ID");
      }
      const fileHash = point.payload?.fileHash;
      if (typeof fileHash !== "string") {
        throw new Error(`Qdrant point ${point.id} has an invalid fileHash during file-version cleanup`);
      }
      if (fileHash !== keepFileHash) obsoletePointIds.add(point.id);
    }
    const nextOffset = page.next_page_offset;
    if (nextOffset === undefined || nextOffset === null) break;
    if (typeof nextOffset !== "string" && typeof nextOffset !== "number") {
      throw new Error("Qdrant file-version cleanup returned an invalid offset");
    }
    if (nextOffset === offset) throw new Error("Qdrant file-version cleanup returned a repeated offset");
    offset = nextOffset;
  }
  if (obsoletePointIds.size > 0) {
    await client.deletePoints(collection, { wait: true, points: [...obsoletePointIds] });
  }
}
