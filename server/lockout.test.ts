import { assert, assertEquals } from "@std/assert";
import { LockoutTimer } from "./lockout.ts";
import { FakeTime } from "@std/testing/time";

const lockoutTime = 60000;
const lockoutLimit = 10;

Deno.test("Lockout - failed login rate limiter", () => {
  using time = new FakeTime();

  testDisabled(new LockoutTimer(NaN, lockoutLimit), "by period");
  testDisabled(new LockoutTimer(lockoutTime, NaN), "by limit");

  testLockout(new LockoutTimer(lockoutTime, 10), "explicit params");
  testLockoutPerMS(new LockoutTimer(lockoutTime, 10), "explicit params");

  function testDisabled(timer: LockoutTimer, txt: string) {
    for (let i = 0; i < 100; i++) {
      assertEquals(
        timer.isLocked(),
        false,
        `Should be unlocked - disabled ${txt} loop ${i}`,
      );
      timer.addCount();
    }
  }

  function testLockoutPerMS(timer: LockoutTimer, txt: string) {
    assert(
      lockoutTime > lockoutLimit,
      `testLockoutPerMS assumes lockoutTime(${lockoutTime}) > lockoutLimit(${lockoutLimit}), so it can fill a bucket in 1ms jumps`,
    );

    const bucketPasses = 2;

    let countLocked = 0;
    let countUnLocked = 0;

    const totalTests = lockoutTime * bucketPasses;

    for (let i = 0; i < totalTests; i++) {
      if (timer.isLocked()) {
        countLocked++;
      } else {
        countUnLocked++;
      }
      timer.addCount();
      time.tick(1);
    }

    // usually this will be bucketPasses+1 buckets
    // but if time aligns could be just bucketPasses buckets
    // and could be in between if it doesn't have time to completely fill the extra bucket

    const expectedUnlocked = lockoutLimit * (bucketPasses + 1);
    const expectedLocked = totalTests - expectedUnlocked;

    const expectedMinUnlocked = lockoutLimit * bucketPasses;
    const expectedMaxLocked = totalTests - expectedMinUnlocked;

    assert(
      countUnLocked >= expectedMinUnlocked && countUnLocked <= expectedUnlocked,
      `Expected between ${expectedMinUnlocked} and ${expectedUnlocked} unlocks in ${bucketPasses} passes of ${lockoutTime}ms, but got ${countUnLocked} (${txt})`,
    );

    assert(
      countLocked >= expectedLocked && countLocked <= expectedMaxLocked,
      `Expected between ${expectedLocked} and ${expectedMaxLocked} locks in ${bucketPasses} passes of ${lockoutTime}ms, but got ${countLocked} (${txt})`,
    );
  }

  function testLockout(timer: LockoutTimer, txt: string) {
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < lockoutLimit; i++) {
        assertEquals(
          timer.isLocked(),
          false,
          `Should be unlocked pass ${pass} loop ${i} ${txt}`,
        );
        timer.addCount();
      }
      // count = lockoutLimit

      for (let i = 0; i < 10; i++) {
        assertEquals(
          timer.isLocked(),
          true,
          `Should be locked before bucket rollover. pass ${pass} loop ${i} ${txt}`,
        );
        timer.addCount();
      }
      // count = lockoutLimit + 10

      time.tick(lockoutTime);
      // bucket should rollover, count=0
    }
  }
});
