import mockfs from 'mock-fs';
import fs from 'node:fs/promises';
import { CrawlOptionsDto } from 'src/dtos/library.dto';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { ProcessRepository } from 'src/repositories/process.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { AutoMocked, automock } from 'test/utils';

interface Test {
  test: string;
  options: CrawlOptionsDto;
  files: Record<string, boolean>;
}

const cwd = process.cwd();

const tests: Test[] = [
  {
    test: 'should return empty when crawling an empty path list',
    options: {
      pathsToCrawl: [],
    },
    files: {},
  },
  {
    test: 'should crawl a single path',
    options: {
      pathsToCrawl: ['/photos/'],
    },
    files: {
      '/photos/image.jpg': true,
    },
  },
  {
    test: 'should exclude by file extension',
    options: {
      pathsToCrawl: ['/photos/'],
      exclusionPatterns: ['**/*.tif'],
    },
    files: {
      '/photos/image.jpg': true,
      '/photos/image.tif': false,
    },
  },
  {
    test: 'should exclude by file extension without case sensitivity',
    options: {
      pathsToCrawl: ['/photos/'],
      exclusionPatterns: ['**/*.TIF'],
    },
    files: {
      '/photos/image.jpg': true,
      '/photos/image.tif': false,
    },
  },
  {
    test: 'should exclude by folder',
    options: {
      pathsToCrawl: ['/photos/'],
      exclusionPatterns: ['**/raw/**'],
    },
    files: {
      '/photos/image.jpg': true,
      '/photos/raw/image.jpg': false,
      '/photos/raw2/image.jpg': true,
      '/photos/folder/raw/image.jpg': false,
      '/photos/crawl/image.jpg': true,
    },
  },
  {
    test: 'should crawl multiple paths',
    options: {
      pathsToCrawl: ['/photos/', '/images/', '/albums/'],
    },
    files: {
      '/photos/image1.jpg': true,
      '/images/image2.jpg': true,
      '/albums/image3.jpg': true,
    },
  },
  {
    test: 'should crawl a single path without trailing slash',
    options: {
      pathsToCrawl: ['/photos'],
    },
    files: {
      '/photos/image.jpg': true,
    },
  },
  {
    test: 'should crawl a single path',
    options: {
      pathsToCrawl: ['/photos/'],
    },
    files: {
      '/photos/image.jpg': true,
      '/photos/subfolder/image1.jpg': true,
      '/photos/subfolder/image2.jpg': true,
      '/image1.jpg': false,
    },
  },
  {
    test: 'should filter file extensions',
    options: {
      pathsToCrawl: ['/photos/'],
    },
    files: {
      '/photos/image.jpg': true,
      '/photos/image.txt': false,
      '/photos/1': false,
    },
  },
  {
    test: 'should include photo and video extensions',
    options: {
      pathsToCrawl: ['/photos/', '/videos/'],
    },
    files: {
      '/photos/image.jpg': true,
      '/photos/image.jpeg': true,
      '/photos/image.heic': true,
      '/photos/image.heif': true,
      '/photos/image.png': true,
      '/photos/image.gif': true,
      '/photos/image.tif': true,
      '/photos/image.tiff': true,
      '/photos/image.webp': true,
      '/photos/image.dng': true,
      '/photos/image.nef': true,
      '/videos/video.mp4': true,
      '/videos/video.mov': true,
      '/videos/video.webm': true,
    },
  },
  {
    test: 'should check file extensions without case sensitivity',
    options: {
      pathsToCrawl: ['/photos/'],
    },
    files: {
      '/photos/image.jpg': true,
      '/photos/image.Jpg': true,
      '/photos/image.jpG': true,
      '/photos/image.JPG': true,
      '/photos/image.jpEg': true,
      '/photos/image.TIFF': true,
      '/photos/image.tif': true,
      '/photos/image.dng': true,
      '/photos/image.NEF': true,
    },
  },
  {
    test: 'should normalize the path',
    options: {
      pathsToCrawl: ['/photos/1/../2'],
    },
    files: {
      '/photos/1/image.jpg': false,
      '/photos/2/image.jpg': true,
    },
  },
  {
    test: 'should return absolute paths',
    options: {
      pathsToCrawl: ['photos'],
    },
    files: {
      [`${cwd}/photos/1.jpg`]: true,
      [`${cwd}/photos/2.jpg`]: true,
      [`/photos/3.jpg`]: false,
    },
  },
  {
    test: 'should support special characters in paths',
    options: {
      pathsToCrawl: ['/photos (new)'],
    },
    files: {
      ['/photos (new)/1.jpg']: true,
    },
  },
];

describe(StorageRepository.name, () => {
  let sut: StorageRepository;
  let processMock: AutoMocked<ProcessRepository>;

  beforeEach(() => {
    processMock = automock(ProcessRepository, { strict: false });
    sut = new StorageRepository(
      automock(LoggingRepository, { args: [undefined, { getEnv: () => ({}) }], strict: false }),
      processMock,
    );
  });

  afterEach(() => {
    mockfs.restore();
    vi.restoreAllMocks();
  });

  describe('checkDiskUsage', () => {
    it('should use POSIX df output', async () => {
      processMock.execFile.mockResolvedValue({
        stdout: [
          'Filesystem 1024-blocks Used Available Capacity Mounted on',
          '/dev/disk 1000 400 500 40% /data/library',
        ].join('\n'),
        stderr: '',
      });

      await expect(sut.checkDiskUsage('/data/library')).resolves.toEqual({
        available: 512_000,
        free: 614_400,
        total: 1_024_000,
      });
      expect(processMock.execFile).toHaveBeenCalledWith('df', ['-Pk', '/data/library']);
    });

    it('should pass paths as separate arguments', async () => {
      processMock.execFile.mockResolvedValue({
        stdout: '/dev/disk 1000 400 500 40% /data/my library',
        stderr: '',
      });

      await sut.checkDiskUsage('/data/my library');

      expect(processMock.execFile).toHaveBeenCalledWith('df', ['-Pk', '/data/my library']);
    });

    it('should fall back to statfs when df fails', async () => {
      processMock.execFile.mockRejectedValue(new Error('df unavailable'));
      vi.spyOn(fs, 'statfs').mockResolvedValue({
        bavail: 500,
        bfree: 600,
        blocks: 1000,
        bsize: 4096,
      } as Awaited<ReturnType<typeof fs.statfs>>);

      await expect(sut.checkDiskUsage('/data/library')).resolves.toEqual({
        available: 2_048_000,
        free: 2_457_600,
        total: 4_096_000,
      });
    });

    it('should fall back to statfs when df output is invalid', async () => {
      processMock.execFile.mockResolvedValue({ stdout: 'invalid', stderr: '' });
      vi.spyOn(fs, 'statfs').mockResolvedValue({
        bavail: 500,
        bfree: 600,
        blocks: 1000,
        bsize: 4096,
      } as Awaited<ReturnType<typeof fs.statfs>>);

      await expect(sut.checkDiskUsage('/data/library')).resolves.toEqual({
        available: 2_048_000,
        free: 2_457_600,
        total: 4_096_000,
      });
    });
  });

  describe('crawl', () => {
    for (const { test, options, files } of tests) {
      it(test, async () => {
        mockfs(Object.fromEntries(Object.keys(files).map((file) => [file, ''])));

        const actual = await sut.crawl(options);
        const expected = Object.entries(files)
          .filter((entry) => entry[1])
          .map(([file]) => file);

        expect(actual.toSorted()).toEqual(expected.toSorted());
      });
    }
  });
});
