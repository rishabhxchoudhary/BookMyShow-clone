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
      const response = await bmsAPI.getSeatmap(showId) as SeatmapResponse;
      setSeatMap(response);
    } catch (err) {
      console.error('Failed to load seat map:', err);
      setError(err instanceof BMSAPIError ? err.message : 'Failed to load seat map');
    } finally {
      setLoading(false);
    }
  };

  const handleSeatClick = (seatId: string) => {
    if (!seatMap) return;

    // Don't allow selection of unavailable seats
    if (seatMap.unavailableSeatIds.includes(seatId)) return;

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
      
      const response = await bmsAPI.createHold({
        showId,
        seatIds: selectedSeats,
        quantity: selectedSeats.length,
      }, 'demo-user-123') as HoldResponse;
      
      setHold(response);
      
      // Navigate to order summary with hold ID
      router.push(`/order-summary/${movieId}/${theatreId}?holdId=${response.holdId}&date=${date}`);
      
    } catch (err) {
      console.error('Failed to create hold:', err);
      setError(err instanceof BMSAPIError ? err.message : 'Failed to hold seats');
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
      case 'selected': return 'bg-green-500 text-white';
      case 'unavailable': return 'bg-red-500 text-white cursor-not-allowed';
      case 'held': return 'bg-yellow-500 text-white cursor-not-allowed';
      default: return 'bg-gray-200 hover:bg-gray-300 cursor-pointer';
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
    acc[seat.row].push(seat);
    return acc;
  }, {} as Record<string, typeof seatMap.layout>);

  // Sort rows and seats
  const sortedRows = Object.keys(seatsByRow).sort();
  sortedRows.forEach(row => {
    seatsByRow[row].sort((a, b) => a.number - b.number);
  });

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">{seatMap.movieTitle}</h1>
        <p className="text-gray-600">{seatMap.theatreName} • {seatMap.startTime}</p>
        <p className="text-lg font-semibold">₹{seatMap.price} per ticket</p>
      </div>

      {error && (
        <Alert className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Seat Map */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Select Your Seats</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Screen */}
              <div className="mb-8">
                <div className="w-full h-4 bg-gradient-to-r from-transparent via-gray-400 to-transparent rounded mb-2"></div>
                <p className="text-center text-sm text-gray-500">SCREEN</p>
              </div>

              {/* Seats */}
              <div className="space-y-4">
                {sortedRows.map(row => (
                  <div key={row} className="flex items-center justify-center gap-2">
                    <span className="w-8 text-center font-semibold">{row}</span>
                    <div className="flex gap-1">
                      {seatsByRow[row].map(seat => {
                        const status = getSeatStatus(seat.seatId);
                        return (
                          <button
                            key={seat.seatId}
                            onClick={() => handleSeatClick(seat.seatId)}
                            disabled={status === 'unavailable' || status === 'held'}
                            className={`w-8 h-8 rounded text-xs font-medium ${getSeatColor(status)}`}
                            title={`${seat.seatId} - ${status}`}
                          >
                            {seat.number}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Legend */}
              <div className="flex justify-center gap-6 mt-8 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-gray-200 rounded"></div>
                  <span>Available</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-green-500 rounded"></div>
                  <span>Selected</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-red-500 rounded"></div>
                  <span>Unavailable</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-yellow-500 rounded"></div>
                  <span>On Hold</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Booking Summary */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle>Booking Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="font-semibold mb-2">Selected Seats</h3>
                {selectedSeats.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {selectedSeats.map(seatId => (
                      <Badge key={seatId} variant="secondary">
                        {seatId}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm">No seats selected</p>
                )}
              </div>

              <div className="border-t pt-4">
                <div className="flex justify-between items-center mb-2">
                  <span>Tickets ({selectedSeats.length})</span>
                  <span>₹{(selectedSeats.length * seatMap.price).toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center font-semibold text-lg">
                  <span>Total</span>
                  <span>₹{(selectedSeats.length * seatMap.price).toFixed(2)}</span>
                </div>
              </div>

              <Button 
                onClick={handleCreateHold}
                disabled={selectedSeats.length === 0 || loading}
                className="w-full"
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Processing...
                  </>
                ) : (
                  `Proceed to Payment (₹${(selectedSeats.length * seatMap.price).toFixed(2)})`
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}