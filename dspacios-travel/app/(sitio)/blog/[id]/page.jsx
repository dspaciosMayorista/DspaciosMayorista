import BlogDetalle from '@/components/sitio/BlogDetalle';
import { getBlogPost, getConfig } from '@/lib/sitio/cms';

export default async function BlogPost({ params }) {
  const { id } = await params;
  const [post, config] = await Promise.all([getBlogPost(id), getConfig()]);

  return <BlogDetalle post={post} whatsappNumero={config.whatsappNumero} />;
}
