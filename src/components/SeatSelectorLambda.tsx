"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { bmsAPI, type SeatmapResponse, type HoldResponse, BMSAPIError } from "@/lib/api-client";

interface SeatSelectorLambdaProps {
  showId: string;
  movieId: string;
  theatreId: string;
  date: string;
}

export function SeatSelectorLambda({
  showId,
  movieId,
  theatreId,
  date,
}: SeatSelectorLambdaProps) {
  const router = useRouter();
  const [seatMap, setSeatMap] = useState<SeatmapResponse | null>(null);
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hold, setHold] = useState<HoldResponse | null>(null);

  // Load seat map on component mount
  useEffect(() => {
    loadSeatMap();
  }, [showId]);

  const loadSeatMap = async () => {
    try {
      setLoading(true);
      setError(null);
      // Use local API which combines Lambda seatmap with local holds
      const res = await fetch(`/api/v1/shows/${showId}/seatmap`);
      if (!res.ok) {
        throw new Error('Failed to load seat map');
      }
      const response = await res.json() as SeatmapResponse;
      setSeatMap(response);
    } catch (err) {
      console.error('Failed to load seat map:', err);
      setError((err as Error).message || 'Failed to load seat map');
    } finally {
      setLoading(false);
    }
  };

  const handleSeatClick = (seatId: string) => {
    if (!seatMap) return;

    // Don't allow selection of unavailable or held seats
    if (seatMap.unavailableSeatIds.includes(seatId)) return;
    if (seatMap.heldSeatIds.includes(seatId)) return;

    setSelectedSeats(prev =>
      prev.includes(seatId)
        ? prev.filter(id => id !== seatId)
        : [...prev, seatId]
    );
  };

  const handleCreateHold = async () => {
    if (selectedSeats.length === 0) {
      setError('Please select at least one seat');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Step 1: Create hold via local API (consistent with order creation)
      const holdRes = await fetch('/api/v1/holds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          showId,
          seatIds: selectedSeats,
          quantity: selectedSeats.length,
        }),
      });

      const holdData = await holdRes.json();

      if (!holdRes.ok) {
        if (holdRes.status === 401) {
          setError('Please sign in to book tickets');
          return;
        }
        throw new Error(holdData.error?.message || 'Failed to hold seats');
      }

      setHold(holdData);

      // Step 2: Create order from hold
      const orderRes = await fetch('/api/v1/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          holdId: holdData.holdId,
          customer: {
            name: 'Guest User',
            email: 'guest@example.com',
            phone: '9999999999',
          },
        }),
      });

      const orderData = await orderRes.json();

      if (!orderRes.ok) {
        throw new Error(orderData.error?.message || 'Failed to create order');
      }

      // Navigate to order summary with order ID
      router.push(`/order-summary/${movieId}/${theatreId}?orderId=${orderData.orderId}`);

    } catch (err) {
      console.error('Failed to create hold/order:', err);
      setError((err as Error).message || 'Failed to hold seats');
    } finally {
      setLoading(false);
    }
  };

  const getSeatStatus = (seatId: string) => {
    if (!seatMap) return 'available';
    
    if (selectedSeats.includes(seatId)) return 'selected';
    if (seatMap.unavailableSeatIds.includes(seatId)) return 'unavailable';
    if (seatMap.heldSeatIds.includes(seatId)) return 'held';
    return 'available';
  };

  const getSeatColor = (status: string) => {
    switch (status) {
      case 'selected': return 'bg-[#1ea83c] text-white border-[#1ea83c]';
      case 'unavailable': return 'bg-gray-300 text-gray-400 cursor-not-allowed border-gray-300';
      case 'held': return 'bg-yellow-400 text-yellow-800 cursor-not-allowed border-yellow-400';
      default: return 'bg-white border-gray-300 hover:border-[#1ea83c] cursor-pointer';
    }
  };

  if (loading && !seatMap) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardContent className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p>Loading seat map...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error && !seatMap) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Alert className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button onClick={loadSeatMap}>Retry</Button>
      </div>
    );
  }

  if (!seatMap) {
    return (
      <div className="container mx-auto px-4 py-8">
        <p>No seat map available</p>
      </div>
    );
  }

  // Group seats by row
  const seatsByRow = seatMap.layout.reduce((acc, seat) => {
    if (!acc[seat.row]) acc[seat.row] = [];
    acc[seat.row]!.push(seat);
    return acc;
  }, {} as Record<string, typeof seatMap.layout>);

  // Sort rows and seats
  const sortedRows = Object.keys(seatsByRow).sort();
  sortedRows.forEach(row => {
    seatsByRow[row]?.sort((a, b) => a.number - b.number);
  });

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      {/* Header */}
      <div className="bg-white border-b shadow-sm">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-xl font-bold text-[#1a1a2e]">{seatMap.movieTitle}</h1>
          <p className="text-sm text-gray-500">{seatMap.theatreName} | {new Date(seatMap.startTime).toLocaleString()}</p>
        </div>
      </div>

      {error && (
        <div className="container mx-auto px-4 pt-4">
          <Alert className="border-red-200 bg-red-50">
            <AlertDescription className="text-red-700">{error}</AlertDescription>
          </Alert>
        </div>
      )}

      <div className="container mx-auto px-4 py-6">
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Seat Map */}
          <div className="lg:col-span-2">
            <Card className="shadow-sm">
              <CardHeader className="border-b bg-gray-50">
                <CardTitle className="text-lg text-[#1a1a2e]">Select Your Seats</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {/* Screen */}
                <div className="mb-10">
                  <div className="w-4/5 mx-auto h-2 bg-gradient-to-b from-gray-400 to-gray-200 rounded-b-xl shadow-md"></div>
                  <p className="text-center text-xs text-gray-400 mt-2 uppercase tracking-wider">All eyes this way please!</p>
                </div>

                {/* Seats */}
                <div className="space-y-3 overflow-x-auto pb-4">
                  {sortedRows.map(row => (
                    <div key={row} className="flex items-center justify-center gap-2">
                      <span className="w-6 text-center text-sm font-medium text-gray-500">{row}</span>
                      <div className="flex gap-1.5">
                        {(seatsByRow[row] ?? []).map(seat => {
                          const status = getSeatStatus(seat.seatId);
                          return (
                            <button
                              key={seat.seatId}
                              onClick={() => handleSeatClick(seat.seatId)}
                              disabled={status === 'unavailable' || status === 'held'}
                              className={`w-7 h-7 rounded-t-lg border-2 text-xs font-medium transition-all ${getSeatColor(status)}`}
                              title={`${seat.seatId} - ${status}`}
                            >
                              {seat.number}
                            </button>
                          );
                        })}
                      </div>
                      <span className="w-6 text-center text-sm font-medium text-gray-500">{row}</span>
                    </div>
                  ))}
                </div>

                {/* Legend */}
                <div className="flex flex-wrap justify-center gap-6 mt-8 pt-6 border-t text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-t-md border-2 border-gray-300 bg-white"></div>
                    <span className="text-gray-600">Available</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-t-md bg-[#1ea83c] border-2 border-[#1ea83c]"></div>
                    <span className="text-gray-600">Selected</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-t-md bg-gray-300 border-2 border-gray-300"></div>
                    <span className="text-gray-600">Sold</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Booking Summary */}
          <div>
            <Card className="shadow-sm sticky top-20">
              <CardHeader className="border-b bg-gray-50">
                <CardTitle className="text-lg text-[#1a1a2e]">Booking Summary</CardTitle>
              </CardHeader>
              <CardContent className="p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-2">Selected Seats</h3>
                  {selectedSeats.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {selectedSeats.map(seatId => (
                        <Badge key={seatId} variant="secondary" className="bg-[#1ea83c]/10 text-[#1ea83c] border border-[#1ea83c]/30">
                          {seatId}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-400 text-sm">Click on seats to select</p>
                  )}
                </div>

                <div className="border-t pt-4 space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600">Tickets ({selectedSeats.length})</span>
                    <span className="text-gray-800">Rs. {selectedSeats.length * seatMap.price}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600">Convenience Fee</span>
                    <span className="text-gray-800">Rs. 0</span>
                  </div>
                  <div className="flex justify-between items-center font-semibold text-lg pt-2 border-t">
                    <span className="text-[#1a1a2e]">Total</span>
                    <span className="text-[#dc3558]">Rs. {selectedSeats.length * seatMap.price}</span>
                  </div>
                </div>

                <Button
                  onClick={handleCreateHold}
                  disabled={selectedSeats.length === 0 || loading}
                  className="w-full bg-[#dc3558] hover:bg-[#c42a4a] text-white py-6 text-base font-semibold"
                >
                  {loading ? (
                    <span className="flex items-center justify-center">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                      Processing...
                    </span>
                  ) : selectedSeats.length === 0 ? (
                    'Select Seats'
                  ) : (
                    `Pay Rs. ${selectedSeats.length * seatMap.price}`
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}