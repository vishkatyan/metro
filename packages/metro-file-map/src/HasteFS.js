/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @flow strict-local
 */

import type {
  FileData,
  FileMetaData,
  FileStats,
  Glob,
  MutableFileSystem,
  Path,
} from './flow-types';

import H from './constants';
import * as fastPath from './lib/fast_path';
import invariant from 'invariant';
import * as path from 'path';
import {globsToMatcher, replacePathSepForGlob} from 'jest-util';

export default class HasteFS implements MutableFileSystem {
  +#rootDir: Path;
  +#files: FileData;

  constructor({rootDir, files}: {rootDir: Path, files: FileData}) {
    this.#rootDir = rootDir;
    this.#files = files;
  }

  _normalizePath(relativeOrAbsolutePath: Path): string {
    return path.isAbsolute(relativeOrAbsolutePath)
      ? fastPath.relative(this.#rootDir, relativeOrAbsolutePath)
      : path.normalize(relativeOrAbsolutePath);
  }

  remove(filePath: Path): ?FileMetaData {
    const normalPath = this._normalizePath(filePath);
    const fileMetadata = this.#files.get(normalPath);
    if (!fileMetadata) {
      return null;
    }
    this.#files.delete(normalPath);
    return fileMetadata;
  }

  bulkAddOrModify(changedFiles: FileData) {
    for (const [relativePath, metadata] of changedFiles) {
      this.#files.set(relativePath, metadata);
    }
  }

  addOrModify(filePath: Path, metadata: FileMetaData) {
    this.#files.set(this._normalizePath(filePath), metadata);
  }

  getSerializableSnapshot(): FileData {
    return new Map(
      Array.from(this.#files.entries(), ([k, v]: [Path, FileMetaData]) => [
        k,
        [...v],
      ]),
    );
  }

  getModuleName(file: Path): ?string {
    const fileMetadata = this._getFileData(file);
    return (fileMetadata && fileMetadata[H.ID]) ?? null;
  }

  getSize(file: Path): ?number {
    const fileMetadata = this._getFileData(file);
    return (fileMetadata && fileMetadata[H.SIZE]) ?? null;
  }

  getDependencies(file: Path): ?Array<string> {
    const fileMetadata = this._getFileData(file);

    if (fileMetadata) {
      return fileMetadata[H.DEPENDENCIES]
        ? fileMetadata[H.DEPENDENCIES].split(H.DEPENDENCY_DELIM)
        : [];
    } else {
      return null;
    }
  }

  getSha1(file: Path): ?string {
    const fileMetadata = this._getFileData(file);
    return (fileMetadata && fileMetadata[H.SHA1]) ?? null;
  }

  exists(file: Path): boolean {
    return this._getFileData(file) != null;
  }

  getAllFiles(): Array<Path> {
    return Array.from(this.getAbsoluteFileIterator());
  }

  getFileIterator(): Iterable<Path> {
    return this.#files.keys();
  }

  *getAbsoluteFileIterator(): Iterable<Path> {
    for (const file of this.getFileIterator()) {
      yield fastPath.resolve(this.#rootDir, file);
    }
  }

  linkStats(file: Path): ?FileStats {
    const fileMetadata = this._getFileData(file);
    if (fileMetadata == null) {
      return null;
    }
    const fileType = fileMetadata[H.SYMLINK] === 0 ? 'f' : 'l';
    const modifiedTime = fileMetadata[H.MTIME];
    invariant(
      typeof modifiedTime === 'number',
      'File in HasteFS missing modified time',
    );
    return {
      fileType,
      modifiedTime,
    };
  }

  matchFiles(pattern: RegExp | string): Array<Path> {
    const regexpPattern =
      pattern instanceof RegExp ? pattern : new RegExp(pattern);
    const files = [];
    for (const file of this.getAbsoluteFileIterator()) {
      if (regexpPattern.test(file)) {
        files.push(file);
      }
    }
    return files;
  }

  /**
   * Given a search context, return a list of file paths matching the query.
   * The query matches against normalized paths which start with `./`,
   * for example: `a/b.js` -> `./a/b.js`
   */
  matchFilesWithContext(
    root: Path,
    context: $ReadOnly<{
      /* Should search for files recursively. */
      recursive: boolean,
      /* Filter relative paths against a pattern. */
      filter: RegExp,
    }>,
  ): Array<Path> {
    const files = [];
    const prefix = './';

    for (const file of this.getAbsoluteFileIterator()) {
      const filePath = fastPath.relative(root, file);

      const isUnderRoot = filePath && !filePath.startsWith('..');
      // Ignore everything outside of the provided `root`.
      if (!isUnderRoot) {
        continue;
      }

      // Prevent searching in child directories during a non-recursive search.
      if (!context.recursive && filePath.includes(path.sep)) {
        continue;
      }

      if (
        context.filter.test(
          // NOTE(EvanBacon): Ensure files start with `./` for matching purposes
          // this ensures packages work across Metro and Webpack (ex: Storybook for React DOM / React Native).
          // `a/b.js` -> `./a/b.js`
          prefix + filePath.replace(/\\/g, '/'),
        )
      ) {
        files.push(file);
      }
    }

    return files;
  }

  matchFilesWithGlob(globs: $ReadOnlyArray<Glob>, root: ?Path): Set<Path> {
    const files = new Set<string>();
    const matcher = globsToMatcher(globs);

    for (const file of this.getAbsoluteFileIterator()) {
      const filePath = root != null ? fastPath.relative(root, file) : file;
      if (matcher(replacePathSepForGlob(filePath))) {
        files.add(file);
      }
    }
    return files;
  }

  _getFileData(filePath: Path): void | FileMetaData {
    // Shortcut to avoid any file path parsing if the given path is already
    // normalised.
    const optimisticMetadata = this.#files.get(filePath);
    if (optimisticMetadata) {
      return optimisticMetadata;
    }
    return this.#files.get(this._normalizePath(filePath));
  }

  getRealPath(filePath: Path): Path {
    throw new Error('HasteFS.getRealPath() is not implemented.');
  }
}
