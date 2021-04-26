import puppeteer, { Page } from "puppeteer";

type CharacterIntroChallenge = {
  prompt: string;
  choices: string[];
  type: "characterIntro";
  correctIndex: number;
};

type CharacterSelectChallenge = {
  prompt: string;
  choices: [];
  correctIndex: number;
  type: "characterSelect";
};

type TranslationChallenge = {
  prompt: string;
  type: "translate";
  correctSolutions: string[];
  correctTokens: string[];
};

type Pair = { transliteration: string; character: string };
type PairsChallenge = {
  type: "characterMatch";
  pairs: Pair[];
};

type ListenTapChallenge = {
  type: "listenTap";
  prompt: string;
  correctTokens: string[];
  correctIndices: number[];
};

type PronunciationChallenge = {
  type: "selectPronunciation";
  correctIndex: number;
};

type SelectChallenge = {
  type: "select";
  correctIndex: number;
};

type Challenge =
  | CharacterIntroChallenge
  | CharacterSelectChallenge
  | TranslationChallenge
  | PairsChallenge
  | ListenTapChallenge
  | PronunciationChallenge
  | SelectChallenge;

const newChallenge = async (page: Page) => {
  const hasTodo = await page.evaluate(() => {
    const todoSkills = Array.from(
      document.querySelectorAll("div[data-test='skill']")
    ).filter((s) => {
      const peices = (s as HTMLElement).innerText.split("\n");
      if (peices.length > 1 && Number(peices[0]) >= 5) {
        return false;
      }

      // Skills which we have access have a gray background
      const style = window.getComputedStyle(
        (s.querySelector("[data-test='skill-icon']") as HTMLElement)
          .firstChild as HTMLElement
      );
      return style.backgroundColor !== "rgb(229, 229, 229)";
    });
    if (todoSkills.length > 0) {
      todoSkills[0]?.scrollIntoView();
      // Open panel to start skill
      (todoSkills[0]?.firstChild as HTMLElement).click();
      return true;
    }
    return false;
  });
  if (hasTodo) {
    await page
      .waitForSelector("[data-test='start-button']", { timeout: 1000 })
      .catch(() => {});
    (await page.$("[data-test='start-button']"))?.click();
  }

  return hasTodo;
};

const login = async (page: Page) => {
  await page.type('[data-test="email-input"]', process.env.DUO_USERNAME!);
  await page.type('[data-test="password-input"]', process.env.DUO_PASSWORD!);
  await page.click('[data-test="register-button"]');
};

const needsIntro = async (page: Page) =>
  !!(await page.$("[data-test='intro-lesson']"));
const startIntro = (page: Page) => page.click("[data-test='intro-lesson']");

const needsCheckpoint = async (page: Page) =>
  !!(await page.$("[data-test='checkpoint-badge']"));

const startCheckpoint = async (page: Page) => {
  await page.evaluate(() => {
    (Array.from(
      document.querySelectorAll("[data-test='checkpoint-badge']")
    ).pop() as HTMLElement | undefined)?.click();
  });
  await page.waitForSelector("[data-test='checkpoint-start-button']");
  (await page.$("[data-test='checkpoint-start-button']"))?.click();
};

const waitForLessonData = async (page: Page): Promise<Challenge[]> => {
  const response = await page.waitForResponse(
    (r) => r.url().endsWith("sessions"),
    { timeout: 5000 }
  );
  const { challenges, adaptiveChallenges } = await response.json();
  return adaptiveChallenges
    ? challenges
        .slice(0, challenges.length - adaptiveChallenges.length)
        .concat(adaptiveChallenges)
    : challenges;
};

const waitForNextButton = (page: Page) =>
  page.waitForSelector("button[data-test='player-next']:not([disabled])");

const nextChallenge = async (page: Page) => {
  while (await page.$("button[data-test='player-next']:not([disabled])")) {
    await page.click("button[data-test='player-next']");
  }
  console.log("next finished");
};

const lessonHandler = async (page: Page) => {
  console.log("Waiting for lesson...");
  const challenges = await waitForLessonData(page).catch((e) => undefined);
  if (!challenges) {
    return;
  }
  console.log(challenges.length);

  await Promise.race([
    waitForNextButton(page),
    page.waitForSelector("[data-test='challenge-header']"),
  ]);
  await nextChallenge(page);

  for (const challenge of challenges) {
    switch (challenge.type) {
      case "characterMatch":
        await page.waitForSelector(
          "[data-test='challenge-tap-token']:not([disabled])"
        );
        for (const pair of challenge.pairs) {
          await page.evaluate(({ transliteration, character }: Pair) => {
            const buttons = Array.from(document.getElementsByTagName("button"));
            buttons
              .find((button) => button.innerText === transliteration)
              ?.click();
            buttons.find((button) => button.innerText === character)?.click();
          }, pair);
        }
        break;
      case "selectPronunciation":
      case "characterIntro":
        await page.waitForSelector(
          '[data-test="challenge-choice"][aria-disabled="false"]'
        );
        await page.waitForSelector(
          `[data-test="challenge-choice"]:nth-child(${
            challenge.correctIndex + 1
          })`
        );
        await page.click(
          `[data-test="challenge-choice"]:nth-child(${
            challenge.correctIndex + 1
          })`
        );
        break;
      case "translate":
        await page.waitForSelector('[data-test="challenge-translate-prompt"]');
        if (!(await page.$('[data-test="challenge-translate-input"]'))) {
          if (
            await page
              .waitForSelector('[data-test="player-toggle-keyboard"]', {
                timeout: 1000,
              })
              .then(() => true)
              .catch(() => false)
          ) {
            await page.click('[data-test="player-toggle-keyboard"]');
          }
        }
        const type = await Promise.race([
          page
            .waitForSelector(
              '[data-test="challenge-translate-input"]:not([disabled])'
            )
            .then(() => "input"),
          page.waitForSelector('[data-test="word-bank"]').then(() => "words"),
        ]);

        if (type === "input") {
          await page.type(
            '[data-test="challenge-translate-input"]:not([disabled])',
            challenge.correctSolutions[0]
          );
        } else {
          await page.evaluate((tokens: string[]) => {
            const buttons = Array.from(
              document.querySelectorAll("[data-test='challenge-tap-token']")
            );
            tokens.forEach((token) => {
              (buttons.find((b) => b.textContent === token) as
                | HTMLElement
                | undefined)?.click();
            });
          }, challenge.correctTokens);
        }

        break;

      case "select":
      case "characterSelect":
        await page.waitForSelector(
          '[data-test="challenge-choice-card"][aria-disabled="false"]'
        );
        await page.click(
          `[data-test="challenge-choice-card"]:nth-child(${
            challenge.correctIndex + 1
          })`
        );
        break;
      case "listenTap":
        await page.waitForSelector('[data-test="player-toggle-keyboard"]');
        if (!(await page.$('[data-test="challenge-translate-input"]'))) {
          await page.click('[data-test="player-toggle-keyboard"]');
        }
        await page.type(
          '[data-test="challenge-translate-input"]',
          challenge.correctTokens.join("")
        );
        break;
      default:
        console.log(challenge);
        throw new Error(`unknown challenge`);
    }

    await waitForNextButton(page);
    await nextChallenge(page);
  }

  await waitForNextButton(page);
  await nextChallenge(page);
};

const main = async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: ["--disable-notifications"],
  });
  const page = await browser.newPage();

  await page.goto("https://www.duolingo.com/");
  await page.click("[data-test='have-account']");
  await login(page);

  while (true) {
    if (await page.$('[data-test="start-lesson"]')) {
      await page.click('[data-test="back-arrow"]');
    }
    await page.waitForSelector('[data-test="skill-tree"]');
    await page.click('[data-test="tree-section"]');
    if (await page.$('[data-tests="close-banner"]')) {
      await page.click('[data-tests="close-banner"]');
    }
    if (await page.$('[data-test="notification-drawer-no-thanks-button"]')) {
      await page.click('[data-test="notification-drawer-no-thanks-button"]');
    }
    if (await needsIntro(page)) {
      await startIntro(page);
      await lessonHandler(page);
    } else {
      const completed = !(await newChallenge(page));
      if (completed) {
        if (await needsCheckpoint(page)) {
          await startCheckpoint(page);
        } else {
          console.log("completed");
          break;
        }
      }

      await lessonHandler(page);
    }
  }
};

main();
