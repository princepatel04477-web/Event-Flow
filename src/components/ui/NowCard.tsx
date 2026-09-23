import { cn } from '@/lib/utils'
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
  /** Where the button goes. The card commits to exactly one destination. */
  actionHref: string
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

      {/* A real link, not a `<button>` with a router.push: this is a
          navigation, so it keeps middle-click, long-press and prefetch.
          `LinkButton` shares `buttonClassName` with `Button`, which is what
          makes the marigold override below land on exactly the same box as
          every other button on the screen.

          WHY THE OVERRIDE WINS: Tailwind emits `bg-brand` and `bg-highlight`
          as separate single-class utilities sorted by name, so
          `bg-highlight` is the later declaration and takes the property —
          independent of the order in this string. `hover:bg-highlight` is
          declared for the same reason (it cancels `hover:bg-brand-hover`),
          because a maroon flash on a marigold button is not the design. */}
      <LinkButton
        href={actionHref}
        size="lg"
        fullWidth={actionFullWidth}
        className={cn(
          'mt-4 border-transparent bg-highlight text-highlight-fg shadow-e1',
          'hover:bg-highlight active:bg-highlight active:brightness-95',
        )}
      >
        {actionLabel}
      </LinkButton>
    </section>
  )
}

export default NowCard
