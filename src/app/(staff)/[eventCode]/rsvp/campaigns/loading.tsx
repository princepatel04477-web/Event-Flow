import { Spinner } from '@/components/ui/Spinner'

export default function CampaignsLoading() {
  return (
    <div className="flex justify-center py-12">
      <Spinner size="lg" />
    </div>
  )
}
