import type { Metadata } from 'next'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>
}): Promise<Metadata> {
  const { token } = await params
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  const imageUrl = `${base}/api/og/share/${token}`
  return {
    title: 'Shared Viz · MF Crypto Analytics',
    description: 'View this trader\'s 3D PnL visualization on MF Crypto Analytics.',
    openGraph: {
      title: 'Shared Viz · MF Crypto Analytics',
      description: 'View this trader\'s 3D PnL visualization on MF Crypto Analytics.',
      images: [{ url: imageUrl, width: 1200, height: 630 }],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Shared Viz · MF Crypto Analytics',
      description: 'View this trader\'s 3D PnL visualization on MF Crypto Analytics.',
      images: [imageUrl],
    },
  }
}

export default function VizShareLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
