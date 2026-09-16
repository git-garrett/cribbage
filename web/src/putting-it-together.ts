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
    { action: "cut", title: "Cut for the deal", explanation: "Each player cuts a card. The lower card deals first. Choose a card in the spread to cut, then watch both cards turn over.", actionLabel: "Cut the deck" },
    { action: "deal", title: "Deal six cards", explanation: "The dealer gives six cards to each player, one at a time. Tap Deal the cards to see your starting hand arrive.", actionLabel: "Deal the cards" },
    { action: "discard", title: "Discard two", explanation: "Each player sends two cards to the dealer’s crib. You are the dealer here: select the 6 and 9 for your own crib, keeping 5, 5, queen, and king in your hand.", actionLabel: "Discard selected" },
    { action: "peg", title: "Peg one card", explanation: "Players alternate cards without taking the count past 31. A queen is on the table and the count is 10. Play any card from your hand. A 5 makes 15 for 2 points, a queen makes a pair for 2 points, and a king takes the count to 20 without scoring.", actionLabel: "Play selected" },
    { action: "count", title: "Count the hand", explanation: "After pegging, each player counts the combinations in their four-card hand with the turn card. With a 2 as the turn card, your 5, 5, queen, and king score 10 points: four fifteens for 8, plus the pair of 5s for 2.", actionLabel: "Count this hand" },
    { action: "alternate", title: "Pass the crib", explanation: "The dealer counts the crib after both hands. On the next hand, the other player deals and owns the crib. Tap Start next hand to pass the crib marker.", actionLabel: "Start next hand" },
    { action: "win", title: "How the game ends", explanation: "Every score moves your peg forward. The first player to reach 121 points wins immediately, whether those points come from pegging, counting a hand, or counting the crib. You do not finish the hand or wait for the other player to count.", actionLabel: "Finish beginner training" },
  ] satisfies PuttingTogetherStep[],
  completionTitle: "You’re ready to play cribbage.",
  completion: "You have cut, dealt, discarded, pegged, counted a hand, and passed the crib. You also know how reaching 121 ends the game. Put those steps together in a real game against Easy.",
} as const;
