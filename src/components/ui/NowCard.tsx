import { cn } from '@/lib/utils'
import { Button } from './Button'
import { LinkButton } from './LinkButton'

export interface NowCardProps {
  /**
   * The marigold line above the headline. Two or three words, lowercase-ish,
   * no colon: "Right now", "Next door", "Waiting on you".
   *
   * It is the ONLY marigold text in the app, and marigold only ever sits on
   * this card's dark plane — on paper it is a 2:1 wash.
   */
  eyebrow: string
  /** The one next thing, in one short sentence. Display face, white. */
  headline: string
  /** One line of context under the headline. Optional. */
  context?: string
  /** The button's label — "Start calling", "Open room 104". */
  actionLabel: string
  /**
   * Where the button goes. Give this OR `onPress`, never both.
   *
   * Optional since the Travel board: the hamper run's card is a NAVIGATION (to
   * the proof screen) and the travel board's is an ACTION (open the family
   * sheet, where the commit lives), and a card whose only control does nothing
   * is not a card. Adding the prop rather than forking the component keeps one
   * dark plane, one marigold, one set of classes.
   */
  actionHref?: string
  /**
   * A write, or opening a sheet on this card's own subject.
   *
   * A `<button>` that navigates would lose middle-click, long-press and
   * prefetch, so the choice is made from the props here rather than left to
   * each caller's memory — same contract as `BottomBar`'s `BarAction`.
   */
  onPress?: () => void
  /**
   * Left-aligned inside the card (default) or pinned full-width to the card's
   * inner edge. Full-width is the right answer on a 360px screen.
   */
  actionFullWidth?: boolean
}

/**
 * The dark card that answers "what do I do next?".
 *
 * ONE per screen, and it is the only dark plane in the v3 look. That is the
 * whole mechanism: everything else on the screen is white cards on paper, so
 * the eye lands on this before it reads a single word, and the single
 * marigold button inside it is the only highlighted control in the app.
 *
 * If a screen has two urgent things, it picks the more urgent one for the
 * card and puts the other in a `Row`. Two Now cards is a screen that has not
 * decided what it is for.
 */
export function NowCard({
  eyebrow,
  headline,
  context,
  actionLabel,
  actionHref,
  onPress,
  actionFullWidth = true,
}: NowCardProps) {
  return (
    <section className="rounded-2xl bg-now p-5 shadow-e2">
      <p className="eyebrow text-highlight">{eyebrow}</p>

      <h2 className="mt-2 font-display text-2xl leading-tight font-bold text-now-fg">
        {headline}
      </h2>

      {context ? (
        <p className="mt-2 text-base leading-snug text-now-muted">{context}</p>
      ) : null}

      {/* A real link when the card navigates — it keeps middle-click,
          long-press and prefetch — and a real button when it acts.
          `LinkButton` shares `buttonClassName` with `Button`, which is what
          makes the marigold override below land on exactly the same box either
          way.

          WHY THE OVERRIDE WINS: Tailwind emits `bg-brand` and `bg-highlight`
          as separate single-class utilities sorted by name, so
          `bg-highlight` is the later declaration and takes the property —
          independent of the order in this string. `hover:bg-highlight` is
          declared for the same reason (it cancels `hover:bg-brand-hover`),
          because a maroon flash on a marigold button is not the design. */}
      {actionHref ? (
        <LinkButton
          href={actionHref}
          size="lg"
          fullWidth={actionFullWidth}
          className={NOW_ACTION_CLASS}
        >
          {actionLabel}
        </LinkButton>
      ) : (
        <Button
          size="lg"
          fullWidth={actionFullWidth}
          onClick={onPress}
          className={NOW_ACTION_CLASS}
        >
          {actionLabel}
        </Button>
      )}
    </section>
  )
}

/** The one marigold control in the app. Shared by both branches above. */
const NOW_ACTION_CLASS = cn(
  'mt-4 border-transparent bg-highlight text-highlight-fg shadow-e1',
  'hover:bg-highlight active:bg-highlight active:brightness-95',
)

export default NowCard
