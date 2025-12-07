/*
 * Copyright 2021 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { pollUntilValid } from './util';

describe('utils', () => {
  describe('pollUntilValid', () => {
    it('should abort immediately when given an aborted signal', () => {
      const controller = new AbortController();
      controller.abort();

      return expect(pollUntilValid({
        fn() {},
        interval: 1,
        signal: controller.signal,
        validate() {},
      })).rejects.toThrow('polling aborted');
    });

    it('should resolve with alwaysResolve and aborted signal', () => {
      const expected = Date.now();
      const controller = new AbortController();
      controller.abort();

      return expect(pollUntilValid({
        alwaysResolve: expected,
        fn() {},
        interval: 1,
        signal: controller.signal,
        validate() {},
      })).resolves.toBe(expected);
    });

    describe('with valid signal', () => {
      beforeAll(() => {
        jest.useFakeTimers({ doNotFake: ['nextTick'] });
      });

      afterAll(() => {
        jest.useRealTimers();
      });

      it('should poll until timeout', async () => {
        const expected = Math.random();
        const fn = jest.fn(() => Promise.resolve(expected));
        const validate = jest.fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true);

        process.nextTick(() => {
          jest.advanceTimersByTime(600);
        });
        await expect(pollUntilValid({
          fn,
          interval: 100,
          signal: new AbortController().signal,
          validate,
        })).resolves.toEqual(expected);
      });

      it('should timeout appropriately', async () => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 500);

        process.nextTick(() => {
          jest.advanceTimersByTime(600);
        });
        await expect(pollUntilValid({
          fn: jest.fn(),
          interval: 100,
          signal: controller.signal,
          validate: jest.fn(() => false),
        })).rejects.toThrow('polling aborted');
      });

      it('should return alwaysResolve after timeout', async () => {
        const controller = new AbortController();
        const expected = Math.random();

        setTimeout(() => controller.abort(), 500);

        process.nextTick(() => {
          jest.advanceTimersByTime(600);
        });
        await expect(pollUntilValid({
          alwaysResolve: expected,
          fn: jest.fn(),
          interval: 100,
          signal: controller.signal,
          validate: jest.fn(() => false),
        })).resolves.toBe(expected);
      });
    });
  });
});
