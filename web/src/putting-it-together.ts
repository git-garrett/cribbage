export type PuttingTogetherAction = "cut" | "deal" | "discard" | "peg" | "count" | "alternate" | "win";

export interface PuttingTogetherStep {
  action: PuttingTogetherAction;
  title: string;
  explanation: string;
  actionLabel: string;
}

export interface PuttingTogetherLesson {
  title: string;
  eyebrow: string;
  introduction: string;
  steps: readonly PuttingTogetherStep[];
  completionTitle: string;
  completion: string;
}

export const PUTTING_IT_TOGETHER: PuttingTogetherLesson = {
  title: "Putting It All Together",
  eyebrow: "Beginner · Complete game",
  introduction: "A cribbage game repeats the same simple rhythm. First you cut to choose the dealer. The dealer gives six cards to each player. Both players discard two cards to the crib, then take turns pegging. You count each hand and then the crib. The crib changes players every hand. Keep moving your pegs until someone reaches 121 points.",
  steps: [
    { action: "cut", title: "Cut for the deal", explanation: "Each player cuts a card. The lower card deals first. Tap Cut the deck to reveal your card.", actionLabel: "Cut the deck" },
    { action: "deal", title: "Deal six cards", explanation: "The dealer gives six cards to each player, one at a time. Tap Deal the cards to see your starting hand arrive.", actionLabel: "Deal the cards" },
    { action: "discard", title: "Discard two", explanation: "Each player sends two cards to the crib. Keep the useful 5, 5, 6, and 9 together here; select the queen and king as the obvious throwaways.", actionLabel: "Discard selected" },
    { action: "peg", title: "Peg one card", explanation: "Players alternate cards without taking the count past 31. A 6 is on the table and the count is 6. Select your 9 to make 15 and score 2 points.", actionLabel: "Play selected" },
    { action: "count", title: "Count the hand", explanation: "After pegging, each player counts the combinations in their four-card hand with the turn card. This simple hand contains one pair of 4s for 2 points.", actionLabel: "Count this hand" },
    { action: "alternate", title: "Pass the crib", explanation: "The dealer counts the crib after both hands. On the next hand, the other player deals and owns the crib. Tap Start next hand to pass the crib marker.", actionLabel: "Start next hand" },
    { action: "win", title: "Reach 121", explanation: "Every score moves your peg forward. The first player to reach the finish hole at 121 wins. You are on 120—tap Peg to 121 to finish the game.", actionLabel: "Peg to 121" },
  ] satisfies PuttingTogetherStep[],
  completionTitle: "You’re ready to play cribbage.",
  completion: "You have cut, dealt, discarded, pegged, counted a hand, passed the crib, and reached 121. Put those steps together in a real game against Easy.",
} as const;
