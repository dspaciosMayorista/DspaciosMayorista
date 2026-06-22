import { notFound } from 'next/navigation';
import BlogDetalle from '@/components/sitio/BlogDetalle';
import { getBlogPost, getConfig } from '@/lib/sitio/cms';

export async function generateMetadata({ params }) {
  const { id } = await params;
  const post = await getBlogPost(id);
  if (!post) return {};
  return {
    title: post.title,
    description: post.summary || undefined,
  };
}

export default async function BlogPost({ params }) {
  const { id } = await params;
  const [post, config] = await Promise.all([getBlogPost(id), getConfig()]);
  if (!post) notFound();

  return <BlogDetalle post={post} whatsappNumero={config.whatsappNumero} />;
}
