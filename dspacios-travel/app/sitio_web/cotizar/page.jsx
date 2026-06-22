import CotizarClient from './CotizarClient';
import { getConfig } from '@/lib/sitio/cms';

export default async function QuoteRequest() {
  const config = await getConfig();
  return <CotizarClient waNumero={config.whatsappNumero} />;
}
