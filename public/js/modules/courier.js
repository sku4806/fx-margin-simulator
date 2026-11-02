/**
 * 🚚 실시간 택배 및 화물 배송조회 모듈 (모바일 최적화 뷰)
 */

const COURIER_CARRIERS = [
  { 
    id: 'kr.cjlogistics', 
    name: 'CJ대한통운', 
    regex: /^(\d{10}|\d{12})$/, 
    queryUrl: 'https://m.cjlogistics.com/kor/tool/parcel/tracking?wobNumber=' 
  },
  { 
    id: 'kr.epost', 
    name: '우체국택배', 
    regex: /^(\d{13})$/, 
    queryUrl: 'https://service.epost.go.kr/trace.RetrieveDomRcvtraceList.comm?sid1=' 
  },
  { 
    id: 'kr.logen', 
    name: '로젠택배', 
    regex: /^(\d{11})$/, 
    queryUrl: 'https://www.ilogen.com/m/personal/trace/' 
  },
  { 
    id: 'kr.hanjin', 
    name: '한진택배', 
    regex: /^(\d{10}|\d{12})$/, 
    queryUrl: 'https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&wblnum=' 
  },
  { 
    id: 'kr.kdexp', 
    name: '경동택배', 
    regex: /^(\d{16})$/, 
    queryUrl: 'https://kdexp.com/service/delivery/delivery_view.do?barcode=' 
  },
  { 
    id: 'us.fedex', 
    name: 'FedEx', 
    regex: /^(\d{12}|\d{15})$/, 
    queryUrl: 'https://www.fedex.com/fedextrack/?trknbr=' 
  },
  { 
    id: 'us.dhl', 
    name: 'DHL Express', 
    regex: /^(\d{10})$/, 
    queryUrl: 'https://www.dhl.com/kr-ko/home/tracking/tracking-express.html?submit=1&tracking-id=' 
  }
];

export function detectCarrier(trackingNo) {
  if (!trackingNo) return null;
  const cleanNo = String(trackingNo).replace(/[^a-zA-Z0-9]/g, '');

  for (const carrier of COURIER_CARRIERS) {
    if (carrier.regex.test(cleanNo)) {
      return carrier;
    }
  }

  return COURIER_CARRIERS[0];
}

export function openTrackingModal(trackingNo) {
  if (!trackingNo || trackingNo.trim() === '-' || trackingNo.trim() === '') {
    alert("등록된 운송장 번호가 없습니다.");
    return;
  }

  const cleanNo = trackingNo.replace(/[^a-zA-Z0-9]/g, '').trim();
  const carrier = detectCarrier(cleanNo);

  const modal = document.getElementById('courierTrackingModal');
  const titleEl = document.getElementById('trackingModalTitle');
  const infoEl = document.getElementById('trackingInfoText');
  const iframeEl = document.getElementById('trackingIframe');
  const directLinkBtn = document.getElementById('trackingDirectLinkBtn');

  let fullUrl = carrier.queryUrl + cleanNo;
  if (carrier.id === 'kr.logen') {
    fullUrl = `https://www.ilogen.com/m/personal/trace/${cleanNo}`;
  }

  if (titleEl) titleEl.innerText = `[${carrier.name}] 실시간 배송 현황`;
  if (infoEl) infoEl.innerText = `송장번호: ${cleanNo}`;
  if (directLinkBtn) {
    directLinkBtn.href = fullUrl;
    directLinkBtn.target = "_blank";
  }

  if (iframeEl) {
    iframeEl.src = fullUrl;
  }

  modal?.classList.remove('hidden');
}
