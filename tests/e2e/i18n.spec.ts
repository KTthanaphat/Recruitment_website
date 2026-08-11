import { expect, test } from "@playwright/test";
import { dictionaries } from "../../src/lib/i18n/dictionary";

test("Thai dictionary has every English translation key", () => {
  expect(Object.keys(dictionaries.th).sort()).toEqual(Object.keys(dictionaries.en).sort());
});
