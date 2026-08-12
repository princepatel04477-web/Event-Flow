import { EventLayoutClient } from './layout-client'

export function generateStaticParams(): Array<Record<string, string>> {
  return [{}]
}

type LayoutProps = {
  children: React.ReactNode
  params: Promise<{ eventCode: string }>
}

export default function EventLayout(props: LayoutProps) {
  return <EventLayoutClient {...props} />
}
